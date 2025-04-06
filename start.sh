#!/bin/bash

# Function to check if filesystem is read-only
check_readonly() {
  # Try to create a temporary file to test write access
  local test_file="/home/container/test_write_access"
  if touch "$test_file" 2>/dev/null; then
    # If successful, remove the test file and return success (0)
    rm "$test_file"
    return 0
  else
    # If failed, filesystem is likely read-only
    return 1
  fi
}

# Set maximum number of attempts
max_attempts=5
attempt=1

# Loop until filesystem is writable or max attempts reached
while ! check_readonly; do
  echo "Filesystem appears to be read-only. Attempt $attempt of $max_attempts."
  
  if [ $attempt -ge $max_attempts ]; then
    echo "Maximum attempts reached. Filesystem still read-only. Exiting."
    exit 1
  fi
  
  echo "Waiting 5 seconds before retrying..."
  sleep 5
  attempt=$((attempt + 1))
done

echo "Filesystem is now writable. Continuing..."



echo "Pulling via GIT"
git reset --hard
git pull https://github.com/M1noa/Sylph
npm install --no-audit --no-fund
echo "Starting application..."
npm start
echo "Stopped."