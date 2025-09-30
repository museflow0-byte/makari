// CommonJS για να μην υπάρχουν issues με "type":"module"
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const axios = require('axios');

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

const PORT = process.env.PORT || 3000;
const DAILY_API_KEY = process.env.DAILY_API_KEY;
const DAILY_DOMAIN = (process.env.DAILY_DOMAIN || '').replace(/^https?:\/\//, '').replace(/\/+$/, '');
const MANAGER_PASS = process.env.MANAGER_PASS || 'museflow';

if (!DAILY_API_KEY) {
  console.warn('[WARN] DAILY_API_KEY is not set. /api/create-call will fail.');
}
if (!DAILY_DOMAIN) {
  console.warn('[WARN] DAILY_DOMAIN is not set. Using example domain "museflow.daily.co".');
}

// ----- Helpers -----
const nowSeconds = () => Math.floor(Date.now() / 1000);

/**
 * Create a Daily room
 * @param {number} durationMinutes
 * @returns {Promise<{name:string,url:string,exp:number}>}
 */
async function createDailyRoom(durationMinutes) {
  const exp = nowSeconds() + Math.floor(durationMinutes * 60);

  const payload = {
    name: `room_${Math.random().toString(36).slice(2, 10)}`,
    privacy: 'private',
    properties: {
      exp,
      nbf: nowSeconds() - 10, // μικρό περιθώριο
      enable_network_ui: true,
      enable_prejoin_ui: true,
      eject_at_room_exp: true,
      // ό,τι άλλο θες...
    }
  };

  const res = await axios.post('https://api.daily.co/v1/rooms', payload, {
    headers: {
      Authorization: `Bearer ${DAILY_API_KEY}`,
      'Content-Type': 'application/json'
    }
  });

  return res.data; // { name, url, ... }
}

/**
 * Build URLs for participants
 */
function buildParticipantLinks(roomName, opts = {}) {
  const base = `https://${DAILY_DOMAIN}/${roomName}`;
  const { clientName = 'Client', modelName = 'Model', managerName = 'Manager' } = opts;

  return {
    model: `${base}?userName=${encodeURIComponent(modelName)}`,
    client: `${base}?userName=${encodeURIComponent(clientName)}`,
    manager: `${base}?userName=${encodeURIComponent(managerName)}`
  };
}

// ----- Routes -----

// Health
app.get('/api/ping', (req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// Manager form (προστασία με pass στο query ή header)
app.get('/manager', (req, res) => {
  const pass = req.query.pass || req.headers['x-manager-pass'];
  if (pass !== MANAGER_PASS) {
    res
      .status(401)
      .send('<h3>Unauthorized</h3><p>Add ?pass=YOUR_PASS στο URL ή X-Manager-Pass header.</p>');
    return;
  }

  res.type('html').send(`
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Start Call</title>
    <style>
      body { font-family: system-ui, sans-serif; max-width: 520px; margin: 48px auto; line-height: 1.45; }
      label { display:block; margin:14px 0 6px; }
      input, button { padding: 10px 12px; font-size: 15px; width:100%; }
      button { margin-top: 16px; background:#111; color:#fff; border:0; border-radius:8px; cursor:pointer; }
      .result { margin-top: 18px; padding:10px; background:#f5f5f5; border-radius:8px; }
      code { word-break: break-all; }
    </style>
  </head>
  <body>
    <h2>Start a new call</h2>
    <form id="f">
      <label>Duration (minutes)</label>
      <input type="number" name="durationMinutes" min="1" value="30" required />

      <label>Client name</label>
      <input name="clientName" value="Nick" />

      <label>Model name</label>
      <input name="modelName" value="Anna" />

      <button type="submit">Create room & get links</button>
    </form>
    <div class="result" id="r" hidden></div>

    <script>
      const f = document.getElementById('f');
      const r = document.getElementById('r');
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(f).entries());
        data.durationMinutes = Number(data.durationMinutes);
        const resp = await fetch('/api/create-call', {
          method: 'POST',
          headers: {'Content-Type': 'application/json', 'X-Manager-Pass': '${MANAGER_PASS}'},
          body: JSON.stringify(data),
        });
        const j = await resp.json();
        r.hidden = false;
        if (!resp.ok) {
          r.innerHTML = '<b>ERROR:</b> <code>'+ (j.error || JSON.stringify(j)) +'</code>';
          return;
        }
        r.innerHTML = \`
          <div><b>Room:</b> \${j.roomName}</div>
          <div><b>Expires at:</b> \${new Date(j.exp*1000).toLocaleString()}</div>
          <hr/>
          <div><b>Model:</b> <code>\${j.links.model}</code></div>
          <div><b>Client:</b> <code>\${j.links.client}</code></div>
          <div><b>Manager:</b> <code>\${j.links.manager}</code></div>
        \`;
      });
    </script>
  </body>
</html>
  `);
});

// Create call (JSON API)
app.post('/api/create-call', async (req, res) => {
  try {
    const pass = req.headers['x-manager-pass'] || req.query.pass;
    if (pass !== MANAGER_PASS) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { durationMinutes, clientName, modelName } = req.body || {};
    const dur = Number(durationMinutes);
    if (!dur || dur < 1 || dur > 240) {
      return res.status(400).json({ error: 'Invalid durationMinutes (1..240)' });
    }

    if (!DAILY_API_KEY || !DAILY_DOMAIN) {
      return res.status(500).json({ error: 'Server misconfigured: DAILY_API_KEY or DAILY_DOMAIN missing' });
    }

    const room = await createDailyRoom(dur);
    const links = buildParticipantLinks(room.name, {
      clientName: clientName || 'Client',
      modelName: modelName || 'Model',
      managerName: 'Manager'
    });

    return res.json({
      ok: true,
      roomName: room.name,
      exp: room.config?.exp || room.exp || null,
      links
    });
  } catch (err) {
    console.error('create-call failed:', err?.response?.data || err.message);
    return res.status(500).json({
      error: err?.response?.data || err.message || 'Unknown error'
    });
  }
});

// Root helper
app.get('/', (req, res) => {
  res.type('text').send(`OK - use /manager?pass=${MANAGER_PASS} or POST /api/create-call`);
});

app.listen(PORT, () => {
  console.log(`YourBrand Calls running on ${PORT}`);
});
