const express = require('express');
const cors = require('cors');
const mongoose = require('mongoose'); // Mongoose import kiya
const { v4: uuidv4 } = require('uuid');

const app = express();
const port = process.env.PORT || 3000;

// Aapka MongoDB Connection String
const MONGO_URI = "mongodb+srv://adminuser:adminuser69@exodus.bjclwzp.mongodb.net/exodus_db?appName=exodus";

// --- 1. MIDDLEWARE ---
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 2. MONGOOSE SCHEMA AND MODEL ---

// Transaction Schema for array in User model
const TransactionSchema = new mongoose.Schema({
    type: { type: String, required: true }, // 'Send' or 'Receive'
    asset: { type: String, required: true },
    amount: { type: Number, required: true },
    targetAddress: { type: String },
    timestamp: { type: String, default: () => new Date().toLocaleString() },
    id: { type: String, default: uuidv4 }
}, { _id: false }); // _id ko disable kiya array elements ke liye

// Asset Map (e.g., assets: { 'BTC': { address: '...', balance: 0.00 } })
const AssetSchema = new mongoose.Schema({
    address: { type: String, required: true },
    balance: { type: Number, default: 0.00 }
}, { _id: false });

// Main User Schema
const UserSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true }, // Flutter se aane wala unique ID
    pin: { type: String, required: true },
    assets: { type: Map, of: AssetSchema, default: {} }, // Use Map for flexible asset keys
    transactions: [TransactionSchema],
    isFrozen: { type: Boolean, default: false }
}, { timestamps: true });

const User = mongoose.model('User', UserSchema);

// --- 3. DATABASE CONNECTION ---
async function connectDB() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log("✅ MongoDB Connected Successfully!");
    } catch (err) {
        console.error("❌ MongoDB Connection Error:", err.message);
        process.exit(1); // Exit process if DB connection fails
    }
}

// Wait for DB connection before starting server
connectDB().then(() => {
    app.listen(port, () => {
        console.log(`Server running on port ${port}`);
        console.log("🚀 Premium Wallet Backend is RUNNING!");
    });
});

// --- 4. HOME PAGE ROUTE ---
app.get('/', (req, res) => {
    res.send(`
        <h1 style="color: green; text-align: center; margin-top: 50px;">
            🚀 Premium Wallet Backend is RUNNING!
        </h1>
        <p style="text-align: center;">Status: Online | Port: ${port} | DB: MongoDB</p>
    `);
});

// --- 5. APP ROUTES (Logic) ---

// Init Account
app.post('/api/init', async (req, res) => {
    if (!req.body || !req.body.userId) {
        return res.status(400).json({ success: false, message: 'Invalid Data' });
    }
    const { userId, pin, wallets } = req.body;

    try {
        const existingUser = await User.findOne({ userId });
        if (existingUser) {
            return res.json({ success: true, message: 'User exists' });
        }

        const assets = {};
        for (const [symbol, address] of Object.entries(wallets)) {
            // New assets are initialized with the AssetSchema structure
            assets[symbol] = { address, balance: 0.00 }; 
        }

        await User.create({ userId, pin, assets, transactions: [], isFrozen: false });
        res.json({ success: true, message: 'Initialized' });

    } catch (error) {
        console.error('Init Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
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
        
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// Get Data
app.post('/api/get-user-data', async (req, res) => {
    try {
        const user = await User.findOne({ userId: req.body.userId }, 'userId assets'); // Only fetch userId and assets
        if(user) res.json({ success: true, data: { userId: user.userId, assets: user.assets } });
        else res.json({ success: false, message: 'User not found' });
    } catch (error) {
        console.error('Get Data Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// Get Transactions
app.post('/api/get-transactions', async (req, res) => {
    try {
        // Only fetch transactions array
        const user = await User.findOne({ userId: req.body.userId }, 'transactions');
        // Reverse is done in memory
        if(user) res.json({ success: true, transactions: user.transactions.reverse() });
        else res.json({ success: false, message: 'User not found' });
    } catch (error) {
        console.error('Get Transactions Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// Send Money
app.post('/api/send-asset', async (req, res) => {
    const { senderId, assetSymbol, receiverAddress, amount } = req.body;
    const numericAmount = parseFloat(amount);
    
    if(!numericAmount || numericAmount <= 0) return res.json({success: false, message: 'Invalid Amount'});

    try {
        // 1. Find Sender
        const sender = await User.findOne({ userId: senderId });
        if(!sender || sender.isFrozen) return res.json({success: false, message: 'Sender Error'});
        
        // Check sender balance (using .get() for Mongoose Map access)
        const senderAsset = sender.assets.get(assetSymbol);
        if(!senderAsset || senderAsset.balance < numericAmount) return res.json({success: false, message: 'Low Balance'});

        // 2. Find Receiver by address
        // Find a user whose assets map contains an entry where the address matches
        const receiver = await User.findOne({ 
            [`assets.${assetSymbol}.address`]: receiverAddress
        });

        if(!receiver) return res.json({success: false, message: 'Invalid Address'});
        
        // 3. Perform Transaction (using Mongoose Session for atomicity is ideal, but for simplicity, we use two updates)
        
        // --- SENDER UPDATE ---
        const senderNewBalance = senderAsset.balance - numericAmount;
        const txSend = { type: 'Send', asset: assetSymbol, amount: numericAmount, targetAddress: receiverAddress, id: uuidv4() };
        
        // Atomically update sender's balance and push transaction
        await User.updateOne(
            { userId: senderId },
            { 
                $set: { [`assets.${assetSymbol}.balance`]: senderNewBalance },
                $push: { transactions: txSend } 
            }
        );

        // --- RECEIVER UPDATE ---
        const receiverAsset = receiver.assets.get(assetSymbol);
        const receiverNewBalance = receiverAsset.balance + numericAmount;
        const txReceive = { 
            type: 'Receive', 
            asset: assetSymbol, 
            amount: numericAmount, 
            targetAddress: senderAsset.address, // Sender's address becomes the target
            id: uuidv4() 
        };

        // Atomically update receiver's balance and push transaction
        await User.updateOne(
            { userId: receiver.userId },
            { 
                $set: { [`assets.${assetSymbol}.balance`]: receiverNewBalance },
                $push: { transactions: txReceive } 
            }
        );
        
        res.json({ success: true, message: 'Sent' });
    } catch (error) {
        console.error('Send Asset Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// --- 6. ADMIN ROUTES (PIN 2626) ---
const authAdmin = (req, res, next) => {
    // Admin PIN is hardcoded as per original logic
    if ((req.query.adminPin || req.body.adminPin) === "2626") next();
    else res.status(401).json({ success: false, message: 'Wrong PIN' });
};

app.get('/api/admin/users', authAdmin, async (req, res) => {
    try {
        // Fetch all users, excluding sensitive data like pin and transactions array (optional)
        const users = await User.find({}, 'userId assets isFrozen'); 
        res.json({ success: true, users });
    } catch (error) {
        console.error('Admin Users Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

app.post('/api/admin/freeze-wallet', authAdmin, async (req, res) => {
    try {
        const result = await User.updateOne(
            { userId: req.body.userId },
            { isFrozen: req.body.status }
        );
        if(result.modifiedCount === 1) res.json({success: true, message: 'Status updated'});
        else res.json({success: false, message: 'User not found or status unchanged'});
    } catch (error) {
        console.error('Admin Freeze Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

app.post('/api/admin/credit', authAdmin, async (req, res) => {
    try {
        const amount = parseFloat(req.body.amount);
        const updateField = `assets.${req.body.assetSymbol}.balance`;
        
        const result = await User.updateOne(
            { userId: req.body.userId },
            { $inc: { [updateField]: amount } } // $inc operator to safely increment the balance
        );
        
        if(result.modifiedCount === 1) res.json({success: true});
        else res.json({success: false, message: 'User or Asset not found'});
    } catch (error) {
        console.error('Admin Credit Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

app.post('/api/admin/deduct', authAdmin, async (req, res) => {
    try {
        const amount = parseFloat(req.body.amount);
        const updateField = `assets.${req.body.assetSymbol}.balance`;
        
        const result = await User.updateOne(
            { userId: req.body.userId },
            { $inc: { [updateField]: -amount } } // $inc operator to safely decrement the balance
        );

        if(result.modifiedCount === 1) res.json({success: true});
        else res.json({success: false, message: 'User or Asset not found'});
    } catch (error) {
        console.error('Admin Deduct Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

app.post('/api/admin/reset-pin', authAdmin, async (req, res) => {
    try {
        const result = await User.updateOne(
            { userId: req.body.userId },
            { pin: req.body.newPin }
        );
        if(result.modifiedCount === 1) res.json({success: true});
        else res.json({success: false, message: 'User not found'});
    } catch (error) {
        console.error('Admin Reset Pin Error:', error);
        res.status(500).json({ success: false, message: 'Server Error' });
    }
});

// --- 7. UPTIME TRICK (Ping Route) ---
app.get('/ping', (req, res) => res.send('pong'));

