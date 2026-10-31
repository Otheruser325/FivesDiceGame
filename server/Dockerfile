FROM node:18-alpine

WORKDIR /app

# turns on secure cookies, CORS checks and proxy trust
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 && chown -R nodejs:nodejs /app
USER nodejs

EXPOSE 8080

# probe the port the server actually listens on (PORT defaults to 8080)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "const p = process.env.PORT || 8080; require('http').get('http://127.0.0.1:' + p + '/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["npm", "start"]
