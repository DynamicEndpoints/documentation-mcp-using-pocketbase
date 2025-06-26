# Use an official Node.js runtime as a parent image.
# Using a specific version like '20-slim' is recommended for reproducibility and smaller image size.
FROM node:20-slim

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy package.json and package-lock.json (or yarn.lock).
# This step is cached, so 'npm install' only runs when these files change.
COPY package*.json ./

# Install app dependencies for production.
RUN npm install --omit=dev

# Copy the rest of the application's source code into the container.
COPY . .

# Define the command to run your app.
# This will be the entry point for your container when it starts.
# Update 'server.js' if your entrypoint file is named differently.
CMD [ "node", "server.js" ]