README.md

Docker desktop installeren
en inloggen met support account

1. Open terminal in root van project

2. Maak docker image: docker build -t supportfloow/voerman-ai-api

3. push image naar account: docker push supportfloow/voerman-ai-api

4. Pull image op VPS: docker pull supportfloow/voerman-ai-api

5. stop draaiende container: docker stop voerman-ai-api & docker remove voerman-ai-api

6. Run nieuwe container: docker run --name voerman-ai-api -d -p 8080:8080 supportfloow/voerman-ai-api
 
 
