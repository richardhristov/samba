FROM denoland/deno:alpine

# Create working directory
WORKDIR /app

# Copy source
COPY . .

# Compile the main app
RUN deno cache main.ts

# Set environment variables
ENV SOURCE_DIR=/share/Downloads
ENV TARGET_DIR=/share/Organized
ENV REAL_RUN=true

# Run the script
CMD ["run", "--allow-env", "--allow-read", "--allow-write", "--allow-net", "--allow-ffi", "main.ts"]