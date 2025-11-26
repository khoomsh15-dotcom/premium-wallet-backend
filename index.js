const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;
const dataFilePath = path.join(__dirname, 'data.json');

// --- 1. MIDDLEWARE (Sabse Zaroori) ---
app.use(cors());
app.use(express.json()); // Yeh line "req.body undefined" error ko rokti hai
app.use(express.urlencoded({ extended: true }));

// --- 2. HOME PAGE ROUTE (Cannot GET / Fix) ---
// Ab "Cannot GET /" nahi aayega, yeh message aayega:
app.get('/', (req, res) => {
    res.send(`
        <h1 style="color: green; text-align: center; margin-top: 50px;">
            🚀 Premium Wallet Backend is RUNNING!
        </h1>
        <p style="text-align: center;">Status: Online | Port: ${port}</p>
    `);
});

// --- Helper Functions ---
function readData() {
    try {
        if (!fs.existsSync(dataFilePath)) {
            const defaultData = { users: [], adminPin: "2626" };
            fs.writeFileSync(dataFilePath, JSON.stringify(defaultData, null, 2));
            return defaultData;
        }
        const data = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error("Database Read Error:", error);
        return { users: [], adminPin: "2626" };
    }
}

function writeData(data) {
    try {
        fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Write Error:", error);
    }
}

// --- 3. APP ROUTES (Logic) ---

// Init Account
app.post('/api/init', (req, res) => {
    if (!req.body || !req.body.userId) {
        return res.status(400).json({ success: false, message: 'Invalid Data' });
    }
    const { userId, pin, wallets } = req.body;
    const db = readData();

    if (db.users.find(u => u.userId === userId)) {
        return res.json({ success: true, message: 'User exists' });
    }

    const assets = {};
    for (const [symbol, address] of Object.entries(wallets)) {
        assets[symbol] = { address, balance: 0.00 }; // Zero Balance Logic
    }

    db.users.push({ userId, pin, assets, transactions: [], isFrozen: false });
    writeData(db);
    res.json({ success: true, message: 'Initialized' });
});

// Login
app.post('/api/login', (req, res) => {
    const { userId, pin } = req.body;
    const db = readData();
    const user = db.users.find(u => u.userId === userId);

    if (!user) return res.json({ success: false, message: 'User not found' });
    if (user.isFrozen) return res.json({ success: false, message: 'Account Frozen' });
    
    if (user.pin === pin) res.json({ success: true, message: 'Success' });
    else res.json({ success: false, message: 'Wrong PIN' });
});

// Get Data
app.post('/api/get-user-data', (req, res) => {
    const user = readData().users.find(u => u.userId === req.body.userId);
    if(user) res.json({ success: true, data: { userId: user.userId, assets: user.assets } });
    else res.json({ success: false });
});

// Get Transactions
app.post('/api/get-transactions', (req, res) => {
    const user = readData().users.find(u => u.userId === req.body.userId);
    if(user) res.json({ success: true, transactions: user.transactions.reverse() });
    else res.json({ success: false });
});

// Send Money
app.post('/api/send-asset', (req, res) => {
    const { senderId, assetSymbol, receiverAddress, amount } = req.body;
    const db = readData();
    
    if(!amount || amount <= 0) return res.json({success: false, message: 'Invalid Amount'});

    const sender = db.users.find(u => u.userId === senderId);
    if(!sender || sender.isFrozen) return res.json({success: false, message: 'Sender Error'});
    if(sender.assets[assetSymbol].balance < amount) return res.json({success: false, message: 'Low Balance'});

    let receiver = null, recKey = null;
    for(const u of db.users) {
        for(const [k, v] of Object.entries(u.assets)) {
            if(v.address === receiverAddress && k === assetSymbol) { receiver = u; recKey = k; }
        }
    }
    if(!receiver) return res.json({success: false, message: 'Invalid Address'});

    // Transfer
    sender.assets[assetSymbol].balance -= amount;
    receiver.assets[recKey].balance += amount;
    
    const tx = { type: 'Send', asset: assetSymbol, amount, targetAddress: receiverAddress, timestamp: new Date().toLocaleString(), id: uuidv4() };
    const rx = { ...tx, type: 'Receive', targetAddress: sender.assets[assetSymbol].address };
    
    sender.transactions.push(tx);
    receiver.transactions.push(rx);
    
    writeData(db);
    res.json({ success: true, message: 'Sent' });
});

// --- 4. ADMIN ROUTES (PIN 2626) ---
const authAdmin = (req, res, next) => {
    if ((req.query.adminPin || req.body.adminPin) === "2626") next();
    else res.status(401).json({ success: false, message: 'Wrong PIN' });
};

app.get('/api/admin/users', authAdmin, (req, res) => res.json({ success: true, users: readData().users }));

app.post('/api/admin/freeze-wallet', authAdmin, (req, res) => {
    const db = readData();
    const u = db.users.find(x => x.userId === req.body.userId);
    if(u) { u.isFrozen = req.body.status; writeData(db); res.json({success: true}); }
    else res.json({success: false});
});

app.post('/api/admin/credit', authAdmin, (req, res) => {
    const db = readData();
    const u = db.users.find(x => x.userId === req.body.userId);
    if(u) { u.assets[req.body.assetSymbol].balance += parseFloat(req.body.amount); writeData(db); res.json({success: true}); }
    else res.json({success: false});
});

app.post('/api/admin/deduct', authAdmin, (req, res) => {
    const db = readData();
    const u = db.users.find(x => x.userId === req.body.userId);
    if(u) { u.assets[req.body.assetSymbol].balance -= parseFloat(req.body.amount); writeData(db); res.json({success: true}); }
    else res.json({success: false});
});

app.post('/api/admin/reset-pin', authAdmin, (req, res) => {
    const db = readData();
    const u = db.users.find(x => x.userId === req.body.userId);
    if(u) { u.pin = req.body.newPin; writeData(db); res.json({success: true}); }
    else res.json({success: false});
});

// --- 5. UPTIME TRICK (Ping Route) ---
app.get('/ping', (req, res) => res.send('pong'));

app.listen(port, () => console.log(`Server running on port ${port}`));


