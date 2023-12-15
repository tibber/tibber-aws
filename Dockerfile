FROM node:20-alpine
ADD . /app
WORKDIR /app
RUN yarn