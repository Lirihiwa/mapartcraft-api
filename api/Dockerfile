FROM node:20-slim

WORKDIR /app/api

COPY api/package*.json ./
RUN npm ci --omit=dev

COPY api/src ./src
COPY src/components/mapart/json /app/src/components/mapart/json

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=3s \
	CMD node -e "fetch('http://localhost:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "src/server.js"]
