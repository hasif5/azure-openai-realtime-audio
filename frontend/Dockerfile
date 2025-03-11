# Stage 1: Build the application
FROM node:22-alpine AS builder
WORKDIR /app

# Copy dependency files and install full dependencies
COPY package*.json ./
RUN npm install

# Copy the source code and build the Next.js app
COPY . .
RUN npm run build

# Prune dev dependencies so node_modules only contains production dependencies
RUN npm prune --production

# Stage 2: Create the production image 
FROM node:22-alpine
WORKDIR /app

# Copy all necessary application files from the builder stage
COPY --from=builder /app .

# Expose the default Next.js port
EXPOSE 3000

# Start the Next.js application by invoking the Next.js binary directly.
CMD ["./node_modules/.bin/next", "start"]