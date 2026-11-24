# 🥡 Marmitas

Planeador de refeições para a semana de trabalho. Pensado para quem cozinha poucos pratos e os repete ao longo da semana.

- **Sorteio de pratos** — escolhe 3 pratos ao acaso e distribui-os pelos dias (por defeito: Seg 1 · Ter 2 · Qua 3 · Qui 1 · Sex 3). Podes fixar 🔒 um prato e sortear só os outros, ou sortear 🎲 um de cada vez.
- **Pratos e receitas opcionais** — basta o nome. Ingredientes e receita só se quiseres. Os ingredientes geram a lista de compras da semana.
- **Comi / não comi** — marca cada dia e, se não comeste, regista o que comeste em vez disso. O histórico mostra a percentagem de cumprimento por semana.
- **Sopa** — regista quando fizeste uma panela (e quantas doses) e os dias em que comeste sopa. Avisa quando a sopa acaba ou já tem muitos dias.
- **Tudo configurável** — dias planeados, número de pratos, evitar repetir pratos das semanas anteriores, doses de sopa.
- Funciona bem no telemóvel (podes "Adicionar ao ecrã principal").

Sem dependências: Node.js 24 + SQLite embutido (`node:sqlite`). Os dados ficam num único ficheiro `marmitas.db`.

## Instalar no ZimaOS

1. Abre o ZimaOS → **App Store** → botão **＋** (canto superior direito) → **Install a customized app**.
2. Clica em **Import** (ícone no canto superior direito do formulário) e cola o conteúdo de [`docker-compose.yml`](docker-compose.yml).
3. Clica em **Install**. A app fica disponível em `http://<ip-do-zima>:8787` e aparece no painel.

Os dados ficam em `/DATA/AppData/marmitas/data`. Para fazer cópia, usa também **Definições → Exportar**.

### Atualizar

Cada `push` para `main` gera uma nova imagem `ghcr.io/rabanete218/marmitas:latest` (GitHub Actions, amd64 + arm64).
No ZimaOS: abre as definições da app e carrega em **Update** (ou faz *rebuild*), ou no terminal:

```sh
docker pull ghcr.io/rabanete218/marmitas:latest && docker restart marmitas
```

## Correr localmente

```sh
npm start          # http://localhost:8080  (dados em ./data)
npm test
```

Variáveis de ambiente: `PORT` (8080), `DATA_DIR` (`./data`, `/data` no Docker), `TZ` (`Europe/Lisbon`).
