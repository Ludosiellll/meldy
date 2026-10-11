# Both images are pinned by digest — the tags as release 44.1 was built (2026-10-11) — and the server's packages by
# backend/constraints.txt: a rebuild runs exactly what was tested. To update, look up the tag's current digest.

# ---- Stage 1: Build frontend ----
FROM node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293 AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# The exam container's tests read the shared samples in contracts/ (../../../../contracts/container/*.json from
# frontend/src/…), and `npm run build` type-checks the tests too (tsc -b over src): the folder sits beside frontend/ as
# in the repository.
COPY contracts/ ../contracts/

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

RUN npm run build

# ---- Stage 2: Production ----
FROM python:3.12-slim@sha256:a6e34c598f2467ed0e9a8d349809fcd8b5c603269512df273a0bb1784edc11b1

# Install nginx
RUN apt-get update && apt-get install -y nginx && rm -rf /var/lib/apt/lists/*

# Copy backend
WORKDIR /app/backend
# Every version is pinned (constraints.txt): a rebuild installs exactly what was tested.
COPY backend/requirements.txt backend/constraints.txt ./
RUN pip install --no-cache-dir -r requirements.txt -c constraints.txt
COPY backend/ .

# Copy built frontend to nginx
COPY --from=frontend-build /app/frontend/dist /usr/share/nginx/html

# Nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf
RUN rm -f /etc/nginx/sites-enabled/default

# Expose HF Spaces port
EXPOSE 7860

# Start nginx + uvicorn
CMD ["sh", "-c", "nginx && uvicorn main:app --host 127.0.0.1 --port 8000"]
