# SocialFlow — Publicador de Redes con IA

App para generar copies + imágenes IA para Instagram, Facebook, WhatsApp, LinkedIn y X/Twitter.

## Deploy en Vercel (10 minutos)

### 1. Subir a GitHub
- Creá un repo en github.com con nombre `socialflow`
- Subí todos estos archivos respetando la estructura:
```
socialflow/
├── index.html
├── vercel.json
├── package.json
├── README.md
└── api/
    ├── generate.js
    └── image.js
```

### 2. Conectar con Vercel
- Entrá a vercel.com → Sign up con GitHub
- New Project → elegí el repo `socialflow`
- Clic en Deploy

### 3. Variables de entorno (IMPORTANTE)
En Vercel → tu proyecto → Settings → Environment Variables:

| Variable | Valor |
|----------|-------|
| `GEMINI_API_KEY` | AIzaSyCr2GPVtsv8QkxNpRusyZxJpcBaqjYTe-E |
| `OPENAI_API_KEY` | sk-proj-enL1OLTghQaUizdc338YXtUD-... |

### 4. Redeploy
Después de agregar las variables: Deployments → Redeploy

## Listo
Tu URL será algo como: `socialflow-xxx.vercel.app`
Cualquier persona puede usarla sin ver las API keys.
