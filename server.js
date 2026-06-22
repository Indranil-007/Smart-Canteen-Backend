// server.js - Smart Canteen Backend with Firebase v11 ESM (WORKING VERSION)
import admin from 'firebase-admin';
import express from 'express';
import cors from 'cors';
import http from 'http';
import { Server as socketIo } from 'socket.io';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

// Get __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============ LOAD SERVICE ACCOUNT & INITIALIZE FIREBASE ============
let serviceAccount;

try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    console.log('🌐 Production environment detected. Loading credentials from environment variables...');
    
    // Clean up any weird double-escaped newlines or hidden spaces before parsing
    let cleanedJsonString = process.env.FIREBASE_SERVICE_ACCOUNT
      .replace(/\\n/g, '\n')
      .trim();
      
    serviceAccount = JSON.parse(cleanedJsonString);
  }
    
    // 💡 THE CRUCIAL FIX: Fix the escaped newline characters in the private key string
    if (serviceAccount.private_key) {
      serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
    }
  } else {
    // Local Testing: Fall back to reading the serviceAccountKey.json file
    const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
    console.log('📂 Local environment detected. Looking for serviceAccountKey.json at:', serviceAccountPath);
    
    const rawData = fs.readFileSync(serviceAccountPath, 'utf8');
    serviceAccount = JSON.parse(rawData);
  }

  console.log('✅ Service account credentials parsed successfully.');
  
  // Initialize Firebase Admin SDK
  console.log('🔄 Initializing Firebase...');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase app initialized');

} catch (error) {
  console.error('❌ Critical Error initializing application:', error.message);
  process.exit(1);
}

const db = admin.firestore();
console.log('✅ Firestore database initialized');

// =========== EXPRESS & SOCKET.IO SETUP ===========
const app = express();
const server = http.createServer(app);

// Use the environment variable, or fallback to localhost for local testing
const allowedOrigin = process.env.CORS_ORIGIN || "http://localhost:3000";

const io = new socketIo(server, {
    cors: {
        origin: allowedOrigin,
        methods: ["GET", "POST", "PUT", "DELETE"],
        credentials: true
    }
});

// =========== MIDDLEWARE ===========
app.use(cors({
    origin: allowedOrigin,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// ============ API ROUTES ============

// 1. CREATE ORDER
app.post('/api/orders/create', async (req, res) => {
  try {
    const { studentId, studentName, items, totalAmount } = req.body;
    
    console.log('📝 Received order request:', { studentId, studentName, totalAmount });
    
    const orderId = `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    const orderData = {
      orderId,
      studentId,
      studentName,
      items,
      totalAmount,
      status: 'pending',
      qrCode: orderId,
      orderTime: new Date().toISOString(),
      completionTime: null
    };
    
    // Save to Firestore
    await db.collection('orders').doc(orderId).set(orderData);
    console.log(`✅ Order saved to Firestore: ${orderId}`);
    
    // Emit to staff dashboard via Socket.io
    io.emit('new-order', orderData);
    console.log(`📡 Emitted new-order event`);
    
    res.json({
      success: true,
      orderId: orderId,
      qrCode: orderId,
      message: 'Order placed successfully'
    });
  } catch (error) {
    console.error('❌ Error creating order:', error);
    res.status(500).json({ 
      error: error.message
    });
  }
});

// 2. GET ALL ORDERS
app.get('/api/orders/all', async (req, res) => {
  try {
    const snapshot = await db.collection('orders')
      .orderBy('orderTime', 'desc')
      .get();
    
    const orders = [];
    snapshot.forEach(doc => {
      orders.push(doc.data());
    });
    
    console.log(`📥 Fetched ${orders.length} orders`);
    res.json(orders);
  } catch (error) {
    console.error('❌ Error fetching orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// 3. GET PENDING ORDERS
app.get('/api/orders/pending', async (req, res) => {
  try {
    const snapshot = await db.collection('orders')
      .where('status', '==', 'pending')
      .orderBy('orderTime', 'asc')
      .get();
    
    const orders = [];
    snapshot.forEach(doc => {
      orders.push(doc.data());
    });
    
    console.log(`📥 Fetched ${orders.length} pending orders`);
    res.json(orders);
  } catch (error) {
    console.error('❌ Error fetching pending orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// 4. UPDATE ORDER STATUS
app.put('/api/orders/:orderId/status', async (req, res) => {
  try {
    const { orderId } = req.params;
    const { status } = req.body;
    
    console.log(`🔄 Updating order ${orderId} to status: ${status}`);
    
    const updateData = { status };
    if (status === 'completed') {
      updateData.completionTime = new Date().toISOString();
    }
    
    await db.collection('orders').doc(orderId).update(updateData);
    console.log(`✅ Order ${orderId} updated`);
    
    const updatedOrder = await db.collection('orders').doc(orderId).get();
    
    if (status === 'completed') {
      io.emit('order-completed', updatedOrder.data());
      console.log(`📡 Emitted order-completed event`);
    }
    
    res.json({ success: true, order: updatedOrder.data() });
  } catch (error) {
    console.error('❌ Error updating order status:', error);
    res.status(500).json({ error: error.message });
  }
});

// 5. GET STUDENT ORDERS
app.get('/api/orders/student/:studentId', async (req, res) => {
  try {
    const { studentId } = req.params;
    const snapshot = await db.collection('orders')
      .where('studentId', '==', studentId)
      .orderBy('orderTime', 'desc')
      .get();
    
    const orders = [];
    snapshot.forEach(doc => {
      orders.push(doc.data());
    });
    
    console.log(`📥 Fetched ${orders.length} orders for student: ${studentId}`);
    res.json(orders);
  } catch (error) {
    console.error('❌ Error fetching student orders:', error);
    res.status(500).json({ error: error.message });
  }
});

// 6. GET MENU ITEMS
app.get('/api/menu', async (req, res) => {
  try {
    const snapshot = await db.collection('menuItems').get();
    const items = [];
    snapshot.forEach(doc => {
      items.push({ id: doc.id, ...doc.data() });
    });
    
    console.log(`📥 Fetched ${items.length} menu items`);
    res.json(items);
  } catch (error) {
    console.error('❌ Error fetching menu:', error);
    res.status(500).json({ error: error.message });
  }
});

// 7. ADD MENU ITEM
app.post('/api/menu', async (req, res) => {
  try {
    const { name, price, category, availability } = req.body;
    
    const itemData = {
      name,
      price,
      category,
      availability: availability || true,
      totalOrders: 0,
      createdAt: new Date().toISOString()
    };
    
    const docRef = await db.collection('menuItems').add(itemData);
    console.log(`✅ Menu item added: ${docRef.id}`);
    
    res.json({ 
      success: true, 
      id: docRef.id,
      ...itemData
    });
  } catch (error) {
    console.error('❌ Error adding menu item:', error);
    res.status(500).json({ error: error.message });
  }
});

// 8. GET ANALYTICS
app.get('/api/analytics/demand', async (req, res) => {
  try {
    const ordersSnapshot = await db.collection('orders').get();
    const orders = [];
    ordersSnapshot.forEach(doc => {
      orders.push(doc.data());
    });
    
    const hourlyData = {};
    orders.forEach(order => {
      const hour = new Date(order.orderTime).getHours();
      hourlyData[hour] = (hourlyData[hour] || 0) + 1;
    });
    
    const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    const completedOrders = orders.filter(o => o.status === 'completed');
    
    let avgPrepTime = 0;
    if (completedOrders.length > 0) {
      const totalTime = completedOrders.reduce((sum, o) => {
        const start = new Date(o.orderTime);
        const end = new Date(o.completionTime);
        return sum + (end - start) / 60000;
      }, 0);
      avgPrepTime = (totalTime / completedOrders.length).toFixed(1);
    }
    
    res.json({
      hourlyData,
      totalRevenue: totalRevenue.toFixed(2),
      averagePrepTime: avgPrepTime,
      totalOrders: orders.length,
      completedOrders: completedOrders.length,
      pendingOrders: orders.filter(o => o.status === 'pending').length
    });
  } catch (error) {
    console.error('❌ Error fetching analytics:', error);
    res.status(500).json({ error: error.message });
  }
});

// 9. GET STATS
app.get('/api/stats', async (req, res) => {
  try {
    const ordersSnapshot = await db.collection('orders').get();
    const orders = [];
    ordersSnapshot.forEach(doc => {
      orders.push(doc.data());
    });
    
    const totalOrders = orders.length;
    const pendingOrders = orders.filter(o => o.status === 'pending').length;
    const completedOrders = orders.filter(o => o.status === 'completed').length;
    const totalRevenue = orders.reduce((sum, o) => sum + o.totalAmount, 0);
    
    const completedOrdersList = orders.filter(o => o.status === 'completed');
    let avgPrepTime = 0;
    if (completedOrdersList.length > 0) {
      const totalTime = completedOrdersList.reduce((sum, o) => {
        const start = new Date(o.orderTime);
        const end = new Date(o.completionTime);
        return sum + (end - start) / 60000;
      }, 0);
      avgPrepTime = (totalTime / completedOrdersList.length).toFixed(1);
    }
    
    res.json({
      totalOrders,
      pendingOrders,
      completedOrders,
      totalRevenue: totalRevenue.toFixed(2),
      averagePrepTime: avgPrepTime
    });
  } catch (error) {
    console.error('❌ Error fetching stats:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============ SOCKET.IO ============
io.on('connection', (socket) => {
  console.log(`✅ Client connected: ${socket.id}`);
  
  socket.on('disconnect', () => {
    console.log(`❌ Client disconnected: ${socket.id}`);
  });
});

// Listen to Firestore changes
db.collection('orders').onSnapshot(snapshot => {
  snapshot.docChanges().forEach(change => {
    if (change.type === 'added' && change.doc.data().status === 'pending') {
      console.log(`📡 New order detected: ${change.doc.id}`);
      io.emit('new-order', change.doc.data());
    }
    if (change.type === 'modified' && change.doc.data().status === 'completed') {
      console.log(`📡 Order completed: ${change.doc.id}`);
      io.emit('order-completed', change.doc.data());
    }
  });
}, error => {
  console.error('❌ Error listening to orders:', error);
});

// ============ HEALTH CHECK ============
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'Backend is running ✅',
    timestamp: new Date().toISOString(),
    firebase: 'Connected 🔥'
  });
});

// ============ START SERVER ============
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`🚀 Smart Canteen Backend with Firebase`);
  console.log(`📍 Server running on http://localhost:${PORT}`);
  console.log(`🔥 Firebase Firestore connected`);
  console.log(`🔄 Real-time Socket.io enabled`);
  console.log(`✅ Ready for requests!`);
  console.log(`${'='.repeat(50)}\n`);
});
