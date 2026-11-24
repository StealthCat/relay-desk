FROM node:24-alpine
WORKDIR /app
COPY --chown=node:node server.mjs inventory.mjs catalog.mjs sample.mjs ./
COPY --chown=node:node public ./public
RUN mkdir -p data config && chown node:node data && echo '[]' > config/repeaters.json
ENV HOST=0.0.0.0 PORT=8080
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=4s CMD node -e "fetch('http://127.0.0.1:8080/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node","server.mjs"]
