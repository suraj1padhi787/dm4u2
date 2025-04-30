# Use Node.js 18 as base image
FROM node:18

# Set working directory
WORKDIR /app

# Copy package files first
COPY package*.json ./

# Install system dependencies required for native modules (like better-sqlite3)
RUN apt-get update && apt-get install -y python3 make g++

# Install dependencies
RUN npm install

# Copy remaining app files
COPY . .

# Expose port (change if your app uses different)
EXPOSE 3000

# Start the app
CMD ["node", "app.js"]
