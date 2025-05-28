# Imagem base com Node.js e apt para instalar o Chromium
FROM node:18.20.4-slim

# Evita prompts durante instalação
ENV DEBIAN_FRONTEND=noninteractive

# Instala o Chromium e dependências do Puppeteer/Venom
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libgdk-pixbuf2.0-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Cria diretório de trabalho
WORKDIR /app

# Copia os arquivos do projeto
COPY api/package*.json ./
COPY api/app.js ./
COPY api/config.json ./
COPY api /app

# Instala as dependências
RUN npm install

# Corrige o caminho do Chrome para o Chromium
ENV CHROME_BIN=/usr/bin/chromium

# Expõe a porta do app
EXPOSE 4000

# Comando de inicialização
CMD ["node", "app.js"]
