require("dotenv").config();
const OpenAI = require("openai");
const axios = require("axios");
const fs = require("fs");

const OPENAI_API_KEY = process.env.CHATGPT_API_KEY;

if (!OPENAI_API_KEY) {
  return {
    success: false,
    data: null,
  };
}

const openai = new OpenAI({
  apiKey: OPENAI_API_KEY,
});

async function processAllFilesWithOpenAI({ fileUrls, emailContent }) {
  try {
    const downloadPromises = fileUrls.map((url, index) =>
      axios
        .get(url, { responseType: "text" })
        .then((response) => ({ index, content: response.data }))
        .catch((error) => {
          console.error(
            `Error downloading file from URL ${url}:`,
            error.message
          );
          return {
            success: false,
            data: null,
          };
        })
    );

    const downloadedFiles = await Promise.all(downloadPromises);
    const validFiles = downloadedFiles.filter((file) => file !== null);

    if (validFiles.length === 0) {
      console.log("No files were successfully downloaded. Exiting.");
    }

    let combinedContent = "";
    validFiles.forEach((file) => {
      combinedContent += `--- Email #${file.index + 1} ---\n\n${
        file.content
      }\n\n`;
    });

    const openaiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `You are excellent at understanding and drafting professional responses to emails related to transportation and associated services.  

You will be provided with:  
1. **Email Content** – The original message from the sender, containing their queries or requirements.  
2. **Combined File Contents** – Any attached or related document content relevant to the sender's request.  

Your task is to write a polite and professional email response that:  
- Starts with:  
  "Hello,  
  Thank you for reaching out!"  
- Acknowledges receipt of their email and/or files.  
- Addresses each query or requirement clearly and accurately.  
- Uses information from the provided file contents when relevant.  
- Maintains a professional, friendly, and business-appropriate tone.  
- Is concise, easy to read, and actionable.  

**Inputs:**  
Email Content:  
${emailContent}  

Combined File Contents:  
${combinedContent}  

**Output:**  
A complete, well-structured reply email.
`,
            },
          ],
        },
      ],
    });

    if (openaiResponse?.choices?.[0]?.message?.content) {
      return {
        success: true,
        data: openaiResponse.choices[0].message.content,
      };
    } else {
      console.log("No valid response from OpenAI.");
      return {
        success: false,
        data: null,
      };
    }
  } catch (error) {
    console.log("openAi.js 🚀🚀 36 error =====", error);
  }
}

async function generateResposneBasedOnEmailAndFiles(
  emailQuery,
  fileContent,
  pineconeContext,
  suggestion = ""
) {
  try {
    const prompt = `You are excellent at understanding and drafting professional responses to emails related to transportation, logistics, and relocation services.

You will be provided with:
1. **User’s Email Query** – The sender’s message, including questions or requests.
2. **Relevant Context** – Information retrieved from previous files or documents related to the sender's request.
3. **File Content** – Any attached or related document content relevant to the sender's request.

Your task is to write a polished, professional email response that:

### Opening
- Always begins with:
  "Hello,
  Thank you for reaching out!"

### Content Requirements
- Acknowledge the sender’s email and any files they provided.
- Clearly answer every question or requirement mentioned in the email.
- Use the provided context **only if it is directly relevant**.
  - **If relevant details are missing**, politely state what is missing and ask for clarification.
  - **Do NOT invent or assume information** that was not provided.
- Provide clear structure using short paragraphs or bullet points when needed.
- Maintain a friendly, professional, business-appropriate tone.
- Keep the email concise, easy to understand, and actionable.

### Style Guidelines
- Personalize the response based on the details provided.
- When information *is* provided (e.g., volume, locations, service type), use it to craft a complete, helpful email.
- When information is *not* provided, request the missing details politely.

### Closing
End the email with:
"Best regards,
Voerman Sales
Voerman International"

### Output
A complete, professional email response reflecting the sender's query and the provided context.`;

    let userMessage = `User’s Email Query: ${emailQuery?.content || emailQuery},
                   File Content: ${fileContent},
                   Relevant Context: ${pineconeContext}`;

    if (suggestion && suggestion.length > 0) {
      userMessage += `,Suggestion for generating email:${suggestion}`;
    }

     fs.writeFileSync('./train-models/test.json', JSON.stringify(emailQuery, null, 2));

    const openaiResponse = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "user",
          content: userMessage,
        },
        {
          role: "system",
          content: prompt,
        },
      ],
    });

    if (openaiResponse?.choices?.[0]?.message?.content) {
      return {
        success: true,
        data: openaiResponse.choices[0].message.content,
      };
    } else {
      console.log("No valid response from OpenAI.");
      return {
        success: false,
        data: null,
      };
    }
  } catch (error) {
    console.log("openAi.js 🚀🚀 36 error =====", error);
    return {
      success: false,
      data: null,
    };
  }
}
async function convertFileToEmbeddings(fileContent) {
  const embedding = await openai.embeddings.create({
    model: "text-embedding-3-small",
    input: fileContent,
  });

  return { embedding: embedding.data[0].embedding };
}

module.exports = {
  processAllFilesWithOpenAI,
  convertFileToEmbeddings,
  generateResposneBasedOnEmailAndFiles,
};
