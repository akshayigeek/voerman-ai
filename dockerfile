# Gebruik een officiële Node.js image als basis
FROM node:22-alpine

# Maak een werkdirectory aan in de container
WORKDIR /usr/src/app

# Kopieer package.json en package-lock.json
COPY package*.json ./

# Installeer dependencies
RUN npm install --production

# Kopieer de rest van de code
COPY . .

# Expose de poort waarop je app draait (bijv. 3000)
EXPOSE 8080

# Start de app
CMD ["node", "api/index.js"]