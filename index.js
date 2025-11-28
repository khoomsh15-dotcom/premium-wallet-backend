const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// ✅ FINAL CONNECTION STRING (Your credentials hardcoded here for Render)
// Aapki link aur password ke anusaar
const MONGO_URI = "mongodb+srv://adminuser:adminuser69@exodus.bjclwzp.mongodb.net/?appName=exodus"; 

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Database Connection
mongoose.connect(MONGO_URI)
    .then(() => console.log("✅ Connected to MongoDB Atlas"))
    .catch(err => console.error("❌ MongoDB Connection Error:", err));

// --- 3. DATA MODELS (Schema) ---
const userSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    pin: { type: String, required: true },
    isFrozen: { type: Boolean, default: false },
    assets: { type: Map, of: new mongoose.Schema({
        address: String,
        balance: Number
    }, { _id: false }) },
    transactions: [{
        id: String,
        type: { type: String }, // 'Send' or 'Receive' or 'Admin...'
        asset: String,
        amount: Number,
        targetAddress: String,
        timestamp: String
    }]
});

const User = mongoose.model('User', userSchema);

// --- 4. ROUTES (Data now interacts with MongoDB) ---

// Initialize Account
app.post('/api/init', async (req, res) => {
    const { userId, pin, wallets } = req.body;
    if (!userId || !pin) return res.status(400).json({ success: false, message: 'Invalid Data' });

    try {
        const existingUser = await User.findOne({ userId });
        if (existingUser) return res.json({ success: true, message: 'User already exists' });

        const assetsMap = {};
        for (const [symbol, address] of Object.entries(wallets)) {
            assetsMap[symbol] = { address, balance: 0.00 };
        }

        const newUser = new User({
            userId,
            pin,
            assets: assetsMap,
            transactions: []
        });

        await newUser.save();
        res.json({ success: true, message: 'Account Created & Secured on Cloud.' });
    } catch (e) {
        res.status(500).json({ success: false, message: e.message });
    }
});

// Login
app.post('/api/login', async (req, res) => {
    const { userId, pin } = req.body;
    try {
        const user = await User.findOne({ userId });
        if (!user) return res.json({ success: false, message: 'User not found' });
        if (user.isFrozen) return res.json({ success: false, message: 'Account Frozen' });

        if (user.pin === pin) res.json({ success: true, message: 'Success' });
        else res.json({ success: false, message: 'Wrong PIN' });
    } catch (e) {
        res.status(500).json({ success: false, message: 'Login Error' });
    }
});

// Get User Data
app.post('/api/get-user-data', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.body.userId });
        if (user) res.json({ success: true, data: { userId: user.userId, assets: user.assets } });
        else res.json({ success: false, message: 'User not found' });
    } catch (e) {
        res.json({ success: false });
    }
});

// Get Transactions
app.post('/api/get-transactions', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.body.userId });
        if (user) res.json({ success: true, transactions: user.transactions.reverse() });
        else res.json({ success: false });
    } catch (e) {
        res.json({ success: false });
    }
});

// Send Money
app.post('/api/send-asset', async (req, res) => {
    const { senderId, assetSymbol, receiverAddress, amount } = req.body;
    const parsedAmount = parseFloat(amount);

    try {
        const sender = await User.findOne({ userId: senderId });
        if (!sender || sender.isFrozen) return res.json({ success: false, message: 'Sender Error' });

        const senderAsset = sender.assets.get(assetSymbol);
        if (!senderAsset || senderAsset.balance < parsedAmount) return res.json({ success: false, message: 'Insufficient Balance' });

        const users = await User.find({});
        let receiver = null;
        
        for (const u of users) {
            const assetData = u.assets.get(assetSymbol);
            if (assetData && assetData.address === receiverAddress) {
                receiver = u;
                break;
            }
        }

        if (!receiver) return res.json({ success: false, message: 'Invalid Wallet Address. User does not exist in our database.' });

        // Perform Transaction
        const receiverAsset = receiver.assets.get(assetSymbol);
        
        senderAsset.balance -= parsedAmount;
        receiverAsset.balance += parsedAmount;

        sender.assets.set(assetSymbol, senderAsset);
        receiver.assets.set(assetSymbol, receiverAsset);

        const timestamp = new Date().toISOString();
        const txId = uuidv4();

        sender.transactions.push({ id: txId, type: 'Send', asset: assetSymbol, amount: parsedAmount, targetAddress: receiverAddress, timestamp });
        receiver.transactions.push({ id: txId, type: 'Receive', asset: assetSymbol, amount: parsedAmount, targetAddress: senderAsset.address, timestamp });

        await sender.save();
        await receiver.save();

        res.json({ success: true, message: 'Sent Successfully' });
    } catch (e) {
        res.json({ success: false, message: 'Transaction Failed: ' + e.message });
    }
});

// --- ADMIN ROUTES (PIN 2626) ---
const authAdmin = (req, res, next) => {
    if ((req.query.adminPin || req.body.adminPin) === "2626") next();
    else res.status(401).json({ success: false, message: 'Unauthorized' });
};

app.get('/api/admin/users', authAdmin, async (req, res) => {
    const users = await User.find({});
    res.json({ success: true, users });
});

app.post('/api/admin/freeze-wallet', authAdmin, async (req, res) => {
    await User.updateOne({ userId: req.body.userId }, { isFrozen: req.body.status });
    res.json({ success: true, message: `Wallet status updated.` });
});

app.post('/api/admin/credit', authAdmin, async (req, res) => {
    const { userId, assetSymbol, amount } = req.body;
    const parsedAmount = parseFloat(amount);
    const user = await User.findOne({ userId });
    
    if (user && user.assets.get(assetSymbol)) {
        const asset = user.assets.get(assetSymbol);
        asset.balance += parsedAmount;
        user.assets.set(assetSymbol, asset);

        user.transactions.push({ id: uuidv4(), type: 'Admin Credit', asset: assetSymbol, amount: parsedAmount, targetAddress: 'SYSTEM', timestamp: new Date().toISOString() });

        await user.save();
        res.json({ success: true, message: `Credited ${parsedAmount} ${assetSymbol}.` });
    } else {
        res.json({ success: false, message: 'User or Asset not found' });
    }
});

app.post('/api/admin/deduct', authAdmin, async (req, res) => {
    const { userId, assetSymbol, amount } = req.body;
    const parsedAmount = parseFloat(amount);
    const user = await User.findOne({ userId });
    
    if (user && user.assets.get(assetSymbol)) {
        const asset = user.assets.get(assetSymbol);
        asset.balance -= parsedAmount;
        user.assets.set(assetSymbol, asset);

        user.transactions.push({ id: uuidv4(), type: 'Admin Deduct', asset: assetSymbol, amount: parsedAmount, targetAddress: 'SYSTEM', timestamp: new Date().toISOString() });

        await user.save();
        res.json({ success: true, message: `Deducted ${parsedAmount} ${assetSymbol}.` });
    } else {
        res.json({ success: false, message: 'User or Asset not found' });
    }
});

app.post('/api/admin/reset-pin', authAdmin, async (req, res) => {
    await User.updateOne({ userId: req.body.userId }, { pin: req.body.newPin });
    res.json({ success: true, message: 'PIN Reset Successfully.' });
});

app.get('/', (req, res) => res.send(`<h1>🚀 Server is Running with MongoDB!</h1><p>Status: OK</p>`));
app.get('/ping', (req, res) => res.send('pong'));

app.listen(port, () => console.log(`Server running on port ${port}`));

