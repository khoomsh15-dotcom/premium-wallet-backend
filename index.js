const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;
const dataFilePath = path.join(__dirname, 'data.json');

// Middleware (Security & Data Parsing)
app.use(cors());
app.use(bodyParser.json());

// --- Helper Functions (Database Handling) ---

// Data read karne ke liye
function readData() {
    try {
        if (!fs.existsSync(dataFilePath)) {
            // Agar file nahi hai to create karo default data ke saath
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

// Data save karne ke liye
function writeData(data) {
    try {
        fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error("Database Write Error:", error);
    }
}

// --- 🚀 APP USER ROUTES ---

// 1. Initialize Account (First Time Open)
app.post('/api/init', (req, res) => {
    const { userId, pin, wallets } = req.body;

    if (!userId || !pin || !wallets) {
        return res.status(400).json({ success: false, message: 'Invalid data provided.' });
    }

    const db = readData();

    // Check if user already exists
    if (db.users.find(u => u.userId === userId)) {
        return res.json({ success: true, message: 'User already exists.' });
    }

    // Prepare Assets Structure (Starts with 0 balance mostly, maybe some bonus)
    const assets = {};
    // Loop through all wallets sent by frontend (BTC, ETH, TRX, etc.)
    for (const [symbol, address] of Object.entries(wallets)) {
        assets[symbol] = {
            address: address,
            balance: 0.00 // Default balance zero
        };
    }
    
    // Welcome Bonus for testing (Optional - remove if not needed)
    if(assets['BTC']) assets['BTC'].balance = 0.005; 
    if(assets['TRX']) assets['TRX'].balance = 50.0;

    const newUser = {
        userId,
        pin, 
        assets,
        transactions: [],
        isFrozen: false,
        createdAt: new Date().toISOString()
    };

    db.users.push(newUser);
    writeData(db);

    console.log(`New User Registered: ${userId}`);
    res.json({ success: true, message: 'Wallet initialized successfully.' });
});

// 2. Login (PIN Verification)
app.post('/api/login', (req, res) => {
    const { userId, pin } = req.body;
    const db = readData();
    const user = db.users.find(u => u.userId === userId);

    if (!user) return res.json({ success: false, message: 'User not found.' });
    
    // Check Freeze Status
    if (user.isFrozen) {
        return res.json({ success: false, message: 'Account Frozen by Admin. Contact Support.' });
    }

    if (user.pin === pin) {
        res.json({ success: true, message: 'Login successful.' });
    } else {
        res.json({ success: false, message: 'Incorrect PIN.' });
    }
});

// 3. Get User Data (Portfolio)
app.post('/api/get-user-data', (req, res) => {
    const { userId } = req.body;
    const db = readData();
    const user = db.users.find(u => u.userId === userId);

    if (!user) return res.json({ success: false, message: 'User not found.' });

    res.json({ success: true, data: { userId: user.userId, assets: user.assets } });
});

// 4. Get Transactions History
app.post('/api/get-transactions', (req, res) => {
    const { userId } = req.body;
    const db = readData();
    const user = db.users.find(u => u.userId === userId);

    if (!user) return res.json({ success: false, message: 'User not found.' });

    // Send transactions (newest first)
    res.json({ success: true, transactions: user.transactions.reverse() });
});

// 5. SEND MONEY Logic (The Core Feature)
app.post('/api/send-asset', (req, res) => {
    const { senderId, assetSymbol, receiverAddress, amount } = req.body;
    const db = readData();

    // Basic Validations
    if (!amount || amount <= 0) return res.json({ success: false, message: 'Invalid amount.' });

    const sender = db.users.find(u => u.userId === senderId);
    if (!sender) return res.json({ success: false, message: 'Sender not found.' });

    // Freeze Check
    if (sender.isFrozen) return res.json({ success: false, message: 'Transaction Failed: Your wallet is frozen.' });

    // Asset & Balance Check
    const senderAsset = sender.assets[assetSymbol];
    if (!senderAsset) return res.json({ success: false, message: 'Asset not supported.' });
    if (senderAsset.balance < amount) return res.json({ success: false, message: `Insufficient ${assetSymbol} Balance.` });

    // Receiver Address Validation (Bot Check)
    let receiver = null;
    let receiverAssetKey = null;

    // Find user who has this address
    for (const u of db.users) {
        for (const [key, val] of Object.entries(u.assets)) {
            if (val.address === receiverAddress) {
                if (key === assetSymbol) {
                    receiver = u;
                    receiverAssetKey = key;
                } else {
                    return res.json({ success: false, message: `Invalid Address: This is a ${key} address, not ${assetSymbol}.` });
                }
            }
        }
    }

    if (!receiver) return res.json({ success: false, message: 'Invalid Wallet Address. User does not exist in our database.' });

    // --- EXECUTE TRANSACTION ---
    const timestamp = new Date().toLocaleString();

    // Deduct
    sender.assets[assetSymbol].balance -= amount;
    // Credit
    receiver.assets[receiverAssetKey].balance += amount;

    // Record for Sender
    sender.transactions.push({
        type: 'Send',
        asset: assetSymbol,
        amount: amount,
        targetAddress: receiverAddress,
        timestamp: timestamp
    });

    // Record for Receiver
    receiver.transactions.push({
        type: 'Receive',
        asset: assetSymbol,
        amount: amount,
        targetAddress: senderAsset.address,
        timestamp: timestamp
    });

    writeData(db);
    res.json({ success: true, message: `Successfully sent ${amount} ${assetSymbol}.` });
});


// --- 👮 ADMIN PANEL ROUTES (PIN: 2626) ---

// Middleware to verify Admin PIN strictly
const verifyAdmin = (req, res, next) => {
    // Frontend should send this in query or body
    const pin = req.query.adminPin || req.body.adminPin;
    if (pin === "2626") {
        next();
    } else {
        res.status(401).json({ success: false, message: 'Unauthorized Admin Access' });
    }
};

// 6. Get All Users (For Admin Dashboard)
app.get('/api/admin/users', verifyAdmin, (req, res) => {
    const db = readData();
    res.json({ success: true, users: db.users });
});

// 7. Freeze/Unfreeze Wallet
app.post('/api/admin/freeze-wallet', verifyAdmin, (req, res) => {
    const { userId, status } = req.body;
    const db = readData();
    const user = db.users.find(u => u.userId === userId);
    
    if (user) {
        user.isFrozen = status;
        writeData(db);
        res.json({ success: true, message: `User ${status ? 'Frozen' : 'Unfrozen'} successfully.` });
    } else {
        res.json({ success: false, message: 'User not found.' });
    }
});

// 8. Admin Credit Balance (Add Money)
app.post('/api/admin/credit', verifyAdmin, (req, res) => {
    const { userId, assetSymbol, amount } = req.body;
    const db = readData();
    const user = db.users.find(u => u.userId === userId);

    if (user && user.assets[assetSymbol]) {
        user.assets[assetSymbol].balance += parseFloat(amount);
        
        // Record Admin Transaction
        user.transactions.push({
            type: 'Admin Credit',
            asset: assetSymbol,
            amount: parseFloat(amount),
            targetAddress: 'System Admin',
            timestamp: new Date().toLocaleString()
        });

        writeData(db);
        res.json({ success: true, message: 'Balance Added Successfully.' });
    } else {
        res.json({ success: false, message: 'User or Asset not found.' });
    }
});

// 9. Admin Deduct Balance (Remove Money)
app.post('/api/admin/deduct', verifyAdmin, (req, res) => {
    const { userId, assetSymbol, amount } = req.body;
    const db = readData();
    const user = db.users.find(u => u.userId === userId);

    if (user && user.assets[assetSymbol]) {
        user.assets[assetSymbol].balance -= parseFloat(amount);
        
        user.transactions.push({
            type: 'Admin Deduct',
            asset: assetSymbol,
            amount: parseFloat(amount),
            targetAddress: 'System Admin',
            timestamp: new Date().toLocaleString()
        });

        writeData(db);
        res.json({ success: true, message: 'Balance Deducted Successfully.' });
    } else {
        res.json({ success: false, message: 'User or Asset not found.' });
    }
});

// 10. Reset User PIN
app.post('/api/admin/reset-pin', verifyAdmin, (req, res) => {
    const { userId, newPin } = req.body;
    const db = readData();
    const user = db.users.find(u => u.userId === userId);

    if (user) {
        user.pin = newPin;
        writeData(db);
        res.json({ success: true, message: 'PIN Reset Successfully.' });
    } else {
        res.json({ success: false, message: 'User not found.' });
    }
});

// Start Server
app.listen(port, () => {
    console.log(`🚀 Server running on port ${port}`);
});

