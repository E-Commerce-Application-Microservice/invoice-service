const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const axios = require('axios');
const PDFDocument = require('pdfkit');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

const MONGO_URI = process.env.MONGO_URI || 'mongodb://mongodb:27017/invoicedb';
mongoose.connect(MONGO_URI).then(() => console.log('Invoice Service: MongoDB connected')).catch(err => console.error(err));

const ORDER_SERVICE = process.env.ORDER_SERVICE_URL || 'http://order-service:3008';
const PAYMENT_SERVICE = process.env.PAYMENT_SERVICE_URL || 'http://payment-service:3009';

const invoiceSchema = new mongoose.Schema({
  invoiceNumber: { type: String, unique: true },
  orderId: { type: String, required: true },
  userId: { type: String, required: true },
  items: [{
    name: String, price: Number, quantity: Number, subtotal: Number
  }],
  subtotal: Number,
  deliveryFee: Number,
  tax: Number,
  totalAmount: Number,
  paymentMethod: String,
  paymentStatus: String,
  transactionId: String,
  shippingAddress: {
    name: String, address: String, city: String, state: String, zipCode: String
  },
  deliveryType: String,
  estimatedDelivery: Date,
  createdAt: { type: Date, default: Date.now }
});
const Invoice = mongoose.model('Invoice', invoiceSchema);

app.get('/health', (req, res) => res.json({ status: 'ok', service: 'invoice-service' }));

// Generate invoice
app.post('/invoices/generate', async (req, res) => {
  try {
    const { orderId, userId } = req.body;
    const existing = await Invoice.findOne({ orderId });
    if (existing) return res.json({ message: 'Invoice already exists', invoice: existing });

    let orderData = {}, paymentData = {};
    try {
      const orderResp = await axios.get(`${ORDER_SERVICE}/orders/detail/${orderId}`);
      orderData = orderResp.data;
    } catch (e) { orderData = req.body; }
    try {
      const payResp = await axios.get(`${PAYMENT_SERVICE}/payments/${orderId}`);
      paymentData = payResp.data;
    } catch (e) { paymentData = {}; }

    const items = (orderData.items || []).map(item => ({
      name: item.name, price: item.price, quantity: item.quantity,
      subtotal: item.price * item.quantity
    }));
    const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
    const deliveryFee = orderData.deliveryFee || 4.99;
    const tax = Math.round(subtotal * 0.08 * 100) / 100;

    const invoiceNumber = 'INV-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5).toUpperCase();
    const invoice = await Invoice.create({
      invoiceNumber, orderId, userId: userId || orderData.userId,
      items, subtotal, deliveryFee, tax,
      totalAmount: subtotal + deliveryFee + tax,
      paymentMethod: paymentData.method || 'credit_card',
      paymentStatus: paymentData.status || 'completed',
      transactionId: paymentData.transactionId || '',
      shippingAddress: orderData.shippingAddress || {},
      deliveryType: orderData.deliveryType || 'normal',
      estimatedDelivery: orderData.estimatedDelivery
    });
    res.status(201).json({ message: 'Invoice generated', invoice });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get invoice by order
app.get('/invoices/:orderId', async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ orderId: req.params.orderId });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
    res.json(invoice);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Download invoice PDF
app.get('/invoices/:orderId/pdf', async (req, res) => {
  try {
    const invoice = await Invoice.findOne({ orderId: req.params.orderId });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const doc = new PDFDocument({ margin: 50 });
    
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename=invoice-${invoice.invoiceNumber}.pdf`);
    
    doc.pipe(res);

    // Header
    doc.fontSize(20).text('Invoice', { align: 'center' });
    doc.moveDown();
    
    // Details
    doc.fontSize(12).text(`Invoice Number: ${invoice.invoiceNumber}`);
    doc.text(`Order ID: ${invoice.orderId}`);
    doc.text(`Date: ${new Date(invoice.createdAt).toLocaleDateString()}`);
    doc.moveDown();
    
    // Items
    doc.fontSize(14).text('Items:', { underline: true });
    doc.moveDown(0.5);
    doc.fontSize(12);
    invoice.items.forEach(item => {
      doc.text(`${item.name} x${item.quantity} - $${item.subtotal.toFixed(2)}`);
    });
    doc.moveDown();
    
    // Summary
    doc.text(`Subtotal: $${invoice.subtotal.toFixed(2)}`);
    doc.text(`Delivery Fee: $${invoice.deliveryFee.toFixed(2)}`);
    doc.text(`Tax: $${invoice.tax.toFixed(2)}`);
    doc.fontSize(14).text(`Total Amount: $${invoice.totalAmount.toFixed(2)}`, { stroke: true });
    doc.moveDown();
    
    doc.fontSize(12).text(`Payment Method: ${invoice.paymentMethod}`);
    doc.text(`Payment Status: ${invoice.paymentStatus}`);
    
    doc.end();
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Get all invoices (admin)
app.get('/invoices', async (req, res) => {
  try {
    const invoices = await Invoice.find().sort({ createdAt: -1 });
    res.json(invoices);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const PORT = process.env.PORT || 3010;
app.listen(PORT, () => console.log(`Invoice Service running on port ${PORT}`));
