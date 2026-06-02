const express = require("express");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const Database = require("better-sqlite3");
const cors = require("cors");
const path = require("path");

const app = express();
const db = new Database("database.db");

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

// Crear tabla de turnos si no existe
db.exec(`
  CREATE TABLE IF NOT EXISTS turnos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre TEXT NOT NULL,
    telefono TEXT NOT NULL,
    servicio TEXT NOT NULL,
    fecha TEXT NOT NULL,
    hora TEXT NOT NULL,
    precio INTEGER NOT NULL,
    estado TEXT DEFAULT 'pendiente',
    creado_en TEXT DEFAULT (datetime('now'))
  )
`);

// Servicios disponibles
const SERVICIOS = [
  { id: "corte", nombre: "Corte de pelo", duracion: 30, precio: 2500 },
  { id: "barba", nombre: "Arreglo de barba", duracion: 20, precio: 1800 },
  { id: "corte_barba", nombre: "Corte + barba", duracion: 50, precio: 3800 },
  { id: "afeitado", nombre: "Afeitado clásico", duracion: 25, precio: 2200 },
];

// Horarios disponibles por día (lunes a sábado)
const HORARIOS = [
  "09:00", "09:30", "10:00", "10:30", "11:00", "11:30",
  "14:00", "14:30", "15:00", "15:30", "16:00", "16:30",
  "17:00", "17:30", "18:00",
];

// ── Rutas ──────────────────────────────────────────

app.get("/api/servicios", (req, res) => {
  res.json(SERVICIOS);
});

app.get("/api/disponibilidad", (req, res) => {
  const { fecha } = req.query;
  if (!fecha) return res.status(400).json({ error: "Falta la fecha" });

  const ocupados = db
    .prepare("SELECT hora FROM turnos WHERE fecha = ? AND estado != 'cancelado'")
    .all(fecha)
    .map((t) => t.hora);

  const disponibles = HORARIOS.map((hora) => ({
    hora,
    disponible: !ocupados.includes(hora),
  }));

  res.json(disponibles);
});

app.post("/api/turnos", (req, res) => {
  const { nombre, telefono, servicio, fecha, hora } = req.body;

  if (!nombre || !telefono || !servicio || !fecha || !hora) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  const servicioData = SERVICIOS.find((s) => s.id === servicio);
  if (!servicioData) return res.status(400).json({ error: "Servicio inválido" });

  const yaOcupado = db
    .prepare("SELECT id FROM turnos WHERE fecha = ? AND hora = ? AND estado != 'cancelado'")
    .get(fecha, hora);

  if (yaOcupado) {
    return res.status(409).json({ error: "Ese horario ya fue reservado" });
  }

  const resultado = db
    .prepare("INSERT INTO turnos (nombre, telefono, servicio, fecha, hora, precio) VALUES (?, ?, ?, ?, ?, ?)")
    .run(nombre, telefono, servicioData.nombre, fecha, hora, servicioData.precio);

  res.json({ ok: true, id: resultado.lastInsertRowid });
});

// ── Panel del barbero ───────────────────────────────

const ADMIN_KEY = "barberia2024";

app.get("/admin", (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).send("Acceso denegado");
  }
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/api/admin/turnos", (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const { fecha } = req.query;
  const query = fecha
    ? "SELECT * FROM turnos WHERE fecha = ? ORDER BY hora"
    : "SELECT * FROM turnos ORDER BY fecha, hora";

  const turnos = fecha
    ? db.prepare(query).all(fecha)
    : db.prepare(query).all();

  res.json(turnos);
});

app.patch("/api/admin/turnos/:id", async (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).json({ error: "No autorizado" });
  }

  const { estado } = req.body;
  const turno = db.prepare("SELECT * FROM turnos WHERE id = ?").get(req.params.id);

  db.prepare("UPDATE turnos SET estado = ? WHERE id = ?").run(estado, req.params.id);

  // Mandar WhatsApp al cliente cuando el barbero confirma
  if (estado === "confirmado" && turno) {
    const [anio, mes, dia] = turno.fecha.split("-");
    const mensaje = `Hola ${turno.nombre}! Tu turno en Bartet Studio fue confirmado ✅\n✂️ ${turno.servicio}\n📅 ${dia}/${mes}/${anio} a las ${turno.hora} hs\nTe esperamos!`;
    const mensajeCodificado = encodeURIComponent(mensaje);
    let tel = turno.telefono.replace(/\D/g, "");
    if (tel.startsWith("11") || tel.startsWith("15")) tel = "549" + tel;
    else if (tel.startsWith("0")) tel = "54" + tel.slice(1);
    else if (!tel.startsWith("54")) tel = "549" + tel;

    try {
      await fetch(`https://api.callmebot.com/whatsapp.php?phone=${tel}&text=${mensajeCodificado}&apikey=9325708`);
    } catch (e) {
      console.error("Error enviando WhatsApp:", e);
    }
  }

  res.json({ ok: true });
});

app.delete("/api/admin/turnos/:id", (req, res) => {
  if (req.query.key !== ADMIN_KEY) {
    return res.status(401).json({ error: "No autorizado" });
  }
  db.prepare("DELETE FROM turnos WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

// ── Iniciar servidor ────────────────────────────────

app.listen(3000, () => {
  console.log("Servidor corriendo en http://localhost:3000");
});