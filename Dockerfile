# Build a self-contained Next.js App Router application.
FROM node:22-bookworm-slim AS build
WORKDIR /app
ARG DATABASE_URL=postgresql://masar:masar@localhost:5432/masar
ENV DATABASE_URL=${DATABASE_URL}
COPY package.json ./
COPY prisma ./prisma
RUN npm install --include=dev --no-audit --no-fund
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
# Prisma CLI and schema are retained so the small deployment stack can initialize its schema.
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
EXPOSE 3000
CMD ["sh", "-c", "npx prisma db push && node server.js"]
