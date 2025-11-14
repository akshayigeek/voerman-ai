const { Pinecone } = require("@pinecone-database/pinecone");
const { getAllFilesContent } = require("./helpers.js");
const { v4: uuidv4 } = require("uuid");
const {
  convertFileToEmbeddings,
  generateResposneBasedOnEmailAndFiles,
} = require("./openAi.js");
const { extractText } = require("./customFileParser.js");

const pc = new Pinecone({
  apiKey: process.env.PINECONE_API_KEY,
});
const index = pc.Index(process.env.PINECONE_INDEX_NAME);

async function storeFileInPinecone(buffer, originalName) {
  let text = await extractText(originalName, buffer);
  if (!text) {
    throw new Error("Failed to extract text");
  }
  let key = uuidv4();
  key = key.replace(/-/g, "");

  // Split into chunks (good for long docs)
  const chunks = text?.match(/.{1,1000}/gs) || [];

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await convertFileToEmbeddings(chunks[i]);

    if (embedding) {
      await index.upsert([
        {
          id: `${key}-${i}`,
          values: embedding.embedding,
          metadata: { file: originalName, chunk: i, fileKey: key },
        },
      ]);
    } else {
      console.error(
        `Failed to generate embedding for chunk ${i} of file ${originalName}`,
        embedding
      );
    }
  }
  return { fileKey: key, totalChunks: chunks.length };
}

async function deleteFromPinecone(fileKey, totalChunks) {
  try {
    const ids = Array.from(
      { length: totalChunks },
      (_, i) => `${fileKey}-${i}`
    );
    const ns = index.namespace(process.env.PINECONE_NAMESPACE);
    await ns.deleteMany(ids);

    console.log(`Deleted ${ids.length} vectors for fileKey: ${fileKey}`);
  } catch (error) {
    console.error("Error deleting from Pinecone:", error);
  }
}

async function generateResponseFromEmbeddings({
  fileUrls,
  emailContent,
  suggestion="",
}) {
  try {
    const combinedContent = await getAllFilesContent(fileUrls);
    const question = `Draft a professional response to an email about transportation services using email content: ${emailContent} and combined File Contents: ${combinedContent}`;
    const questionEmbedding = await convertFileToEmbeddings(question);

    const queryResponse = await index.query({
      vector: questionEmbedding.embedding,
      topK: 5,
      includeMetadata: true,
    });

    const context = queryResponse.matches
      .map((m) => m.metadata?.text || "")
      .join("\n");

    const response = await generateResposneBasedOnEmailAndFiles(
      emailContent,
      combinedContent,
      context,
      suggestion
    );

    return response;
  } catch (error) {
    console.log("pinecone.js 🚀🚀 36 error =====", error);
  }
}

module.exports = {
  storeFileInPinecone,
  deleteFromPinecone,
  generateResponseFromEmbeddings,
};
