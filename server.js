const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const dbPath = path.join(__dirname, 'tasks.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            text TEXT NOT NULL,
            completed INTEGER DEFAULT 0,
            last_completed_date TEXT,
            FOREIGN KEY(user_id) REFERENCES users(id)
        )`);
    }
});

app.post('/api/register', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hashedPassword], function(err) {
            if (err) {
                return res.status(400).json({ error: 'Username already exists' });
            }
            res.json({ success: true, userId: this.lastID });
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err) return res.status(500).json({ error: err.message });
        if (!user) return res.status(401).json({ error: 'Invalid username or password' });

        try {
            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch) {
                return res.status(401).json({ error: 'Invalid username or password' });
            }

            res.json({ success: true, userId: user.id, username: user.username });
        } catch (hashErr) {
            res.status(500).json({ error: hashErr.message });
        }
    });
});

app.get('/api/tasks/:userId', (req, res) => {
    const { userId } = req.params;
    db.all('SELECT * FROM tasks WHERE user_id = ? ORDER BY id DESC', [userId], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });

        const today = new Date().toISOString().split('T')[0];
        rows.forEach(task => {
            if (task.completed === 1 && task.last_completed_date !== today) {
                db.run(`UPDATE tasks SET completed = 0 WHERE id = ?`, [task.id]);
                task.completed = 0;
            }
        });
        res.json(rows);
    });
});

app.post('/api/tasks', (req, res) => {
    const { userId, text } = req.body;
    if (!userId || !text) return res.status(400).json({ error: 'Missing data' });

    db.run(`INSERT INTO tasks (user_id, text, completed, last_completed_date) VALUES (?, ?, 0, NULL)`, [userId, text], function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID, text, completed: 0 });
    });
});

app.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const { text, completed } = req.body;
    const today = new Date().toISOString().split('T')[0];

    if (completed !== undefined) {
        const newCompleted = completed ? 1 : 0;
        const completionDate = newCompleted === 1 ? today : null;
        db.run(`UPDATE tasks SET completed = ?, last_completed_date = ? WHERE id = ?`, [newCompleted, completionDate, id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ updated: this.changes });
        });
    } else if (text !== undefined) {
        db.run(`UPDATE tasks SET text = ? WHERE id = ?`, [text, id], function(err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ updated: this.changes });
        });
    }
});

app.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    db.run(`DELETE FROM tasks WHERE id = ?`, id, function(err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ deleted: this.changes });
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});