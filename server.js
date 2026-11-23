const express = require('express');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

async function initDb() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS tasks (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                text TEXT NOT NULL,
                completed INTEGER DEFAULT 0,
                last_completed_date TEXT
            )
        `);

        console.log('Connected to PostgreSQL and ensured tables exist.');
    } catch (err) {
        console.error('Error initializing database:', err.message);
    }
}

initDb();

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        const result = await pool.query(
            `INSERT INTO users (username, password) VALUES ($1, $2) RETURNING id`,
            [username, hashedPassword]
        );
        res.json({ success: true, userId: result.rows[0].id });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(400).json({ error: 'Username already exists' });
        }
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;

    try {
        const result = await pool.query(`SELECT * FROM users WHERE username = $1`, [username]);
        const user = result.rows[0];

        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        res.json({ success: true, userId: user.id, username: user.username });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/tasks/:userId', async (req, res) => {
    const { userId } = req.params;

    try {
        const result = await pool.query(
            'SELECT * FROM tasks WHERE user_id = $1 ORDER BY id DESC',
            [userId]
        );
        const rows = result.rows;
        const today = new Date().toISOString().split('T')[0];

        for (const task of rows) {
            if (task.completed === 1 && task.last_completed_date !== today) {
                await pool.query(`UPDATE tasks SET completed = 0 WHERE id = $1`, [task.id]);
                task.completed = 0;
            }
        }

        res.json(rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/tasks', async (req, res) => {
    const { userId, text } = req.body;
    if (!userId || !text) {
        return res.status(400).json({ error: 'Missing data' });
    }

    try {
        const result = await pool.query(
            `INSERT INTO tasks (user_id, text, completed, last_completed_date)
             VALUES ($1, $2, 0, NULL)
             RETURNING id, text, completed`,
            [userId, text]
        );
        res.json(result.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;
    const { text, completed } = req.body;
    const today = new Date().toISOString().split('T')[0];

    try {
        if (completed !== undefined) {
            const newCompleted = completed ? 1 : 0;
            const completionDate = newCompleted === 1 ? today : null;
            const result = await pool.query(
                `UPDATE tasks SET completed = $1, last_completed_date = $2 WHERE id = $3`,
                [newCompleted, completionDate, id]
            );
            res.json({ updated: result.rowCount });
        } else if (text !== undefined) {
            const result = await pool.query(
                `UPDATE tasks SET text = $1 WHERE id = $2`,
                [text, id]
            );
            res.json({ updated: result.rowCount });
        } else {
            res.json({ updated: 0 });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/tasks/:id', async (req, res) => {
    const { id } = req.params;

    try {
        const result = await pool.query(`DELETE FROM tasks WHERE id = $1`, [id]);
        res.json({ deleted: result.rowCount });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});