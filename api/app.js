var express = require("express");
var helmet = require("helmet");
var cors = require("cors");
var venom = require("venom-bot");
var fs = require('fs');
var path = require('path');

const config = require('./config.json');

let serviceStatus = 'Initializing'; 
let qrCode = null; // Variável para armazenar o QR Code
let clientInstance = null; // Armazena a instância atual do cliente Venom

// Criação da aplicação Express
var app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Permite scripts inline e unsafe-eval
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'", `${config.apiHost}:${config.apiPort}`] // Atualizado para usar as configurações
    }
  }
}));

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  console.log("Recebendo solicitação: ", req.body);
  next();
});

// Inicia o servidor na porta definida no config.json
app.listen(config.apiPort, () => {
  console.log(`Servidor rodando na porta ${config.apiPort}`);
});

// Endpoint para obter o QR Code
app.get("/api/qrcode", (req, res) => {
  if (qrCode) {
    res.json({ qrCode });
  } else {
    res.status(404).json({ error: 'QR Code não disponível no momento' });
  }
});

// Endpoint para obter o status do serviço
app.get("/api/status", (req, res) => {
  res.json({ status: serviceStatus });
});

// Endpoint para renovar o token
app.post("/api/renew-token", async (req, res) => {
  if (clientInstance) {
    try {
      // Encerra a instância atual do Venom Bot
      await clientInstance.close();
      clientInstance = null;
      console.log('Venom Bot encerrado com sucesso.');
    } catch (error) {
      console.error('Erro ao encerrar o Venom Bot:', error);
      return res.status(500).json({ error: 'Erro ao encerrar o Venom Bot' });
    }
  }

  const sessionPath = config.sessionDataPath;

  // Remove todos os arquivos da pasta de sessão
  fs.rm(sessionPath, { recursive: true, force: true }, async (err) => {
    if (err) {
      console.error('Erro ao renovar o token:', err);
      return res.status(500).json({ error: 'Erro ao renovar o token' });
    }

    // Aguarda um curto período para garantir que todos os processos foram encerrados
    await new Promise(resolve => setTimeout(resolve, 2000)); // Aguarda 2 segundos

    // Reinicia a sessão após a remoção da pasta
    startVenom()
      .then((client) => {
        clientInstance = client;
        serviceStatus = 'Logged in';
        res.json({ message: 'Token renovado com sucesso!' });
      })
      .catch((erro) => {
        console.error('Erro ao iniciar a nova sessão:', erro);
        serviceStatus = 'Error';
        res.status(500).json({ error: 'Erro ao renovar o token' });
      });
  });
});

// Função para iniciar o Venom Bot
function startVenom() {
  return venom.create(
    {
      session: config.venomSessionName, // nome da sessão do config.json
      browserArgs: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu'
      ],
      executablePath: config.chromeExecutablePath, // Caminho para o Chrome instalado
      disableSpins: true, // Desativar spins para melhorar a persistência de sessão
      cacheEnabled: false, // Desativar cache para evitar problemas de sessão
      useChrome: config.useChrome, // Usar o Chrome conforme configuração
      puppeteerOptions: {
        args: ['--no-sandbox', '--disable-setuid-sandbox'] // Argumentos do Puppeteer
      },
      sessionDataPath: config.sessionDataPath, // Caminho para armazenar os dados da sessão
      logQR: true
    },
    // Callback para o QR Code
    (base64Qr, asciiQR, attempts, urlCode) => {
      console.log('QR Code gerado (base64):', base64Qr);
      qrCode = base64Qr; // Armazena o QR Code em base64
    },
    // Callback para o status da sessão
    (statusSession, session) => {
      console.log('Status Session: ', statusSession);
      console.log('Session name: ', session);
      serviceStatus = statusSession; // Atualiza a variável com o status atual
    }
  )
  .then((client) => {
    clientInstance = client;

    // Escuta mudanças de estado
    client.onStateChange((state) => {
      console.log('Estado da sessão:', state);
      serviceStatus = state; // Atualiza a variável com o estado atual
      if (state === 'CONFLICT' || state === 'UNLAUNCHED') {
        client.useHere(); // Força a sessão a ser usada aqui
      } else if (state === 'CONNECTED') {
        qrCode = null; // Limpa o QR Code
      }
    });

    // Opcional: Escuta mudanças na stream (usado para reconexões)
    client.onStreamChange((state) => {
      console.log('Estado da stream:', state);
    });

    start(client);
    return client;
  })
  .catch((erro) => {
    console.error('Erro ao iniciar o venom-bot:', erro);
    serviceStatus = 'Error'; // Define o status como erro
  });
}

// Inicia o Venom Bot ao iniciar o servidor
startVenom();

// Função para configurar as rotas que dependem do cliente Venom
function start(client) {
  // Enviar Mensagem
  app.post("/api/message", async (req, res, next) => {
    if (!clientInstance) {
      return res.status(503).json({ error: 'Cliente não inicializado' });
    }

    const chatid = req.body.number;

    let recipient;
    if (chatid.endsWith('@g.us') || chatid.endsWith('@c.us')) {
      recipient = chatid;
    } else {
      recipient = chatid + '@c.us';
    }

    const { title, message } = req.body;
    const fullMessage = title ? `${title}\n${message}` : message;

    try {
      console.log('Enviando mensagem para:', recipient);
      await clientInstance.sendText(recipient, fullMessage);
      res.json({ number: chatid, title, message });
    } catch (error) {
      console.error('Erro ao enviar a mensagem:', error);
      res.status(500).json({ error: 'Erro ao enviar a mensagem' });
    }
  });

  // Obter Grupos com fallback (contatos -> chats)
 app.get("/api/groups", async (req, res, next) => {
  if (!clientInstance) {
    return res.status(503).json({ error: 'Cliente não inicializado' });
  }

  try {
    let groups = [];

    const contacts = await clientInstance.getAllContacts();
    console.log('[DEBUG] Contatos:', contacts.length);
    groups = contacts.filter(c => c.isGroup);
    console.log('[DEBUG] Grupos encontrados em getAllContacts():', groups.length);

    if (groups.length === 0) {
      const chats = await clientInstance.getAllChatsWithMessages();
      console.log('[DEBUG] Chats com mensagens:', chats.length);
      groups = chats.filter(c => c.isGroup && c.name);
      console.log('[DEBUG] Grupos encontrados em getAllChatsWithMessages():', groups.length);
    }

    const groupDetails = groups.map(group => ({
      id: group.id?._serialized || group.id,
      name: group.name || '(sem nome)'
    }));

    console.log('[DEBUG] Grupos enviados para o frontend:', groupDetails);
    res.json(groupDetails);
  } catch (error) {
    console.error('Erro ao obter os grupos:', error);
    res.status(500).json({ error: 'Erro ao obter os grupos' });
  }
});

}

