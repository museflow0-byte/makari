import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
app.use(express.json());
app.use(cors());

const DAILY_API_KEY = process.env.DAILY_API_KEY;
const DAILY_DOMAIN = process.env.DAILY_DOMAIN;         // π.χ. museflow.daily.co
const MANAGER_PASS = process.env.MANAGER_PASS || 'museflow';
const ROOM_PRIVACY = (process.env.ROOM_PRIVACY || 'public').toLowerCase(); // 'public' | 'private'
const PORT = process.env.PORT || 3000;

// helper: φτιάχνει όνομα δωματίου
const randomRoomName = () => `room_${Math.random().toString(36).slice(2, 10)}`;

app.get('/', (_req, res) => {
  res.send('OK — use POST /api/create-call');
});

/**
 * POST /api/create-call
 * body: { clientName: string, modelName: string, durationMinutes: number }
 * returns: { model, client, managerStealth }
 */
app.post('/api/create-call', async (req, res) => {
  try {
    const { clientName = 'Client', modelName = 'Model', durationMinutes = 30 } = req.body || {};

    if (!DAILY_API_KEY || !DAILY_DOMAIN) {
      return res.status(500).json({ error: 'Server misconfigured: missing DAILY_API_KEY or DAILY_DOMAIN' });
    }

    // exp: σε δευτερόλεπτα (UNIX time) — όταν να λήξει το room
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + Math.max(5, Number(durationMinutes) * 60); // τουλάχιστον 5s από τώρα

    // payload για Daily API
    const payload = {
      name: randomRoomName(),
      privacy: ROOM_PRIVACY,                     // <— ΕΔΩ default PUBLIC
      properties: {
        exp,
        eject_at_room_exp: true,
        enable_prejoin_ui: true,
        enable_chat: true
      }
    };

    // δημιουργία room
    const createRes = await axios.post(
      'https://api.daily.co/v1/rooms',
      payload,
      { headers: { Authorization: `Bearer ${DAILY_API_KEY}`, 'Content-Type': 'application/json' } }
    );

    const room = createRes.data;
    // βασικό URL δωματίου
    const roomUrl = `https://${DAILY_DOMAIN}/${room.name}`;

    // Επιστρέφουμε τρία link:
    // - model (με το όνομα της κοπέλας)
    // - client (με όνομα πελάτη)
    // - managerStealth (κρυφό/χωρίς εμφανές όνομα – βάζω ένα query flag π.χ. mgr=1)
    const modelUrl   = `${roomUrl}?userName=${encodeURIComponent(modelName)}&role=model`;
    const clientUrl  = `${roomUrl}?userName=${encodeURIComponent(clientName)}&role=client`;
    const managerUrl = `${roomUrl}?userName=Manager&mgr=1&pass=${encodeURIComponent(MANAGER_PASS)}`;

    return res.json({
      model: modelUrl,
      client: clientUrl,
      managerStealth: managerUrl,
      roomPrivacy: ROOM_PRIVACY,
      expiresAt: exp
    });

  } catch (err) {
    console.error('create-call error:', err?.response?.data || err.message);
    res.status(500).json({ error: 'Failed to create room', details: err?.response?.data || err.message });
  }
});

// 404 fallback
app.use((_req, res) => res.status(404).send('Not Found'));

app.listen(PORT, () => {
  console.log(`YourBrand Calls running on ${PORT}`);
  console.log(`ROOM_PRIVACY = ${ROOM_PRIVACY}`);
});
