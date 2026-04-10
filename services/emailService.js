const nodemailer = require("nodemailer");

// Email configuration (using Gmail for demonstration)
// In production, use environment variables for security
const transporter = nodemailer.createTransporter({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER || "your-email@gmail.com", // Replace with your email
    pass: process.env.EMAIL_PASS || "your-app-password", // Replace with your app password
  },
});

// Send order confirmation email to user
const sendOrderConfirmationEmail = async (userEmail, orderDetails) => {
  try {
    const orderId = orderDetails._id ? orderDetails._id.toString().slice(-8).toUpperCase() : "N/A";
    const orderDate = orderDetails.createdAt ? new Date(orderDetails.createdAt).toLocaleDateString() : new Date().toLocaleDateString();
    
    const itemsHtml = orderDetails.items.map(item => `
      <tr>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.name}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">${item.quantity || 1}</td>
        <td style="padding: 8px; border: 1px solid #ddd;">$${item.price}</td>
        <td style="padding: 8px; border: 1px solid #td;">$${(item.price * (item.quantity || 1)).toFixed(2)}</td>
      </tr>
    `).join("");

    const mailOptions = {
      from: process.env.EMAIL_USER || "your-email@gmail.com",
      to: userEmail,
      subject: `Order Confirmation - #${orderId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Order Confirmation</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #166534; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .order-details { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
            .table { width: 100%; border-collapse: collapse; margin: 15px 0; }
            .table th, .table td { padding: 8px; border: 1px solid #ddd; text-align: left; }
            .table th { background: #166534; color: white; }
            .total { text-align: right; font-size: 18px; font-weight: bold; margin: 15px 0; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
            .status { background: #dcfce7; color: #166534; padding: 5px 10px; border-radius: 3px; display: inline-block; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>HealthCare Clinic</h1>
              <p>Order Confirmation</p>
            </div>
            
            <div class="content">
              <div class="order-details">
                <h2>Order Details</h2>
                <p><strong>Order ID:</strong> #${orderId}</p>
                <p><strong>Date:</strong> ${orderDate}</p>
                <p><strong>Payment Method:</strong> ${orderDetails.paymentMethod || "Cash"}</p>
                <p><strong>Status:</strong> <span class="status">${orderDetails.status || "Pending"}</span></p>
              </div>

              <h3>Order Items</h3>
              <table class="table">
                <thead>
                  <tr>
                    <th>Medicine</th>
                    <th>Quantity</th>
                    <th>Unit Price</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  ${itemsHtml}
                </tbody>
              </table>
              
              <div class="total">
                Total Amount: $${orderDetails.total}
              </div>
            </div>
            
            <div class="footer">
              <p>Thank you for choosing HealthCare Clinic!</p>
              <p>For any queries, please contact our support team.</p>
              <p>This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log("Order confirmation email sent:", result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error("Error sending order confirmation email:", error);
    return { success: false, error: error.message };
  }
};

// Send order status update email to user
const sendOrderStatusUpdateEmail = async (userEmail, orderDetails, newStatus) => {
  try {
    const orderId = orderDetails._id ? orderDetails._id.toString().slice(-8).toUpperCase() : "N/A";
    
    const statusColors = {
      "Pending": "#fef3c7",
      "Approved": "#dbeafe", 
      "Out for Delivery": "#fef3c7",
      "Delivered": "#dcfce7",
      "Cancelled": "#fee2e2"
    };

    const mailOptions = {
      from: process.env.EMAIL_USER || "your-email@gmail.com",
      to: userEmail,
      subject: `Order Status Update - #${orderId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>Order Status Update</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #166534; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .status-update { background: white; padding: 20px; margin: 15px 0; border-radius: 5px; text-align: center; }
            .status-badge { 
              background: ${statusColors[newStatus] || "#fef3c7"}; 
              color: #333; 
              padding: 10px 20px; 
              border-radius: 5px; 
              font-size: 18px; 
              font-weight: bold;
              display: inline-block;
              margin: 10px 0;
            }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>HealthCare Clinic</h1>
              <p>Order Status Update</p>
            </div>
            
            <div class="content">
              <div class="status-update">
                <h2>Your order status has been updated!</h2>
                <p><strong>Order ID:</strong> #${orderId}</p>
                <div class="status-badge">${newStatus}</div>
                <p style="margin-top: 15px;">
                  ${getStatusMessage(newStatus)}
                </p>
              </div>
            </div>
            
            <div class="footer">
              <p>Thank you for choosing HealthCare Clinic!</p>
              <p>For any queries, please contact our support team.</p>
              <p>This is an automated message. Please do not reply to this email.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log("Status update email sent:", result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error("Error sending status update email:", error);
    return { success: false, error: error.message };
  }
};

// Helper function to get status-specific messages
const getStatusMessage = (status) => {
  switch (status) {
    case "Pending":
      return "Your order has been received and is being processed.";
    case "Approved":
      return "Your order has been approved and is being prepared for delivery.";
    case "Out for Delivery":
      return "Your order is on the way! You should receive it soon.";
    case "Delivered":
      return "Your order has been successfully delivered. Thank you for your purchase!";
    case "Cancelled":
      return "Your order has been cancelled. Please contact support if you have any questions.";
    default:
      return "Your order status has been updated.";
  }
};

// Send new order notification to admin
const sendNewOrderNotificationEmail = async (adminEmail, orderDetails, customerName) => {
  try {
    const orderId = orderDetails._id ? orderDetails._id.toString().slice(-8).toUpperCase() : "N/A";
    
    const mailOptions = {
      from: process.env.EMAIL_USER || "your-email@gmail.com",
      to: adminEmail,
      subject: `New Order Received - #${orderId}`,
      html: `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <title>New Order Notification</title>
          <style>
            body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
            .container { max-width: 600px; margin: 0 auto; padding: 20px; }
            .header { background: #166534; color: white; padding: 20px; text-align: center; }
            .content { padding: 20px; background: #f9f9f9; }
            .order-info { background: white; padding: 15px; margin: 15px 0; border-radius: 5px; }
            .action-button { background: #166534; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; }
            .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <h1>HealthCare Clinic</h1>
              <p>New Order Received</p>
            </div>
            
            <div class="content">
              <div class="order-info">
                <h2>Order Details</h2>
                <p><strong>Order ID:</strong> #${orderId}</p>
                <p><strong>Customer:</strong> ${customerName}</p>
                <p><strong>Total Amount:</strong> $${orderDetails.total}</p>
                <p><strong>Date:</strong> ${new Date().toLocaleDateString()}</p>
                <p><strong>Items:</strong> ${orderDetails.items.length} items</p>
              </div>
              
              <p style="text-align: center; margin: 20px 0;">
                <a href="https://clinic-backend-mxto.onrender.com/admin" class="action-button">
                  View Order in Admin Dashboard
                </a>
              </p>
            </div>
            
            <div class="footer">
              <p>This is an automated message from HealthCare Clinic.</p>
            </div>
          </div>
        </body>
        </html>
      `,
    };

    const result = await transporter.sendMail(mailOptions);
    console.log("New order notification sent to admin:", result.messageId);
    return { success: true, messageId: result.messageId };
  } catch (error) {
    console.error("Error sending new order notification:", error);
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendOrderConfirmationEmail,
  sendOrderStatusUpdateEmail,
  sendNewOrderNotificationEmail,
};
