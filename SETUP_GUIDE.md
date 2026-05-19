# Goal Tracker - Enterprise Edition Setup Guide

## Overview

Goal Tracker is now a complete enterprise role-based performance management system. All public user registration has been removed, and only administrators can create users.

---

## System Architecture

### User Roles

1. **Admin** - System administrator with full user management capabilities
2. **Manager** - Can review and approve goals for assigned employees
3. **Employee** - Can create, update, and track personal goals

### Key Features

✅ **No Public Registration** - Only admins can create users  
✅ **Role-Based Access Control** - Strict authorization on all routes  
✅ **User Management Dashboard** - Admin interface for creating/editing users  
✅ **Audit Logging** - All admin actions are logged  
✅ **Enterprise Styling** - Unified modern UI across all pages  
✅ **Session Management** - Support for both persistent and session-only logins  

---

## Initial Setup Instructions

### Step 1: Start the Backend Server

```bash
cd Backend
npm install
npm run dev
```

The server will start on `http://localhost:5000`

### Step 2: Initialize Demo Users

Run the following command to create demo user accounts:

```bash
curl -X POST http://localhost:5000/api/auth/seed-demo-users
```

This will create or reset:
- **Admin** - admin@test.com / admin123
- **Manager** - manager@test.com / manager123
- **Employee** - vipul@test.com / employee123

### Step 3: Access the Application

Open `frontend/login.html` in a browser or serve the frontend from a local server:

```bash
# Option 1: Use a simple HTTP server (Python)
cd frontend
python -m http.server 8000

# Option 2: Use Node.js simple server
npx http-server frontend
```

Then navigate to `http://localhost:8000/login.html`

### Step 4: Login

Use any of the demo credentials or create new users from the Admin dashboard.

---

## Login Page

### User Experience

1. **Email & Password fields** - Standard login
2. **Remember me checkbox** - Persistent login (localStorage)
3. **Demo buttons** - Quick access to demo accounts
4. **Enterprise note** - "Account access is managed by the administrator"
5. **Forgot password link** - (For future implementation)

### Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@test.com | admin123 |
| Manager | manager@test.com | manager123 |
| Employee | vipul@test.com | employee123 |

---

## Admin User Management

### Accessing User Management

1. Login as admin
2. User management section is visible at the top of the admin dashboard
3. Click "Add Employee", "Add Manager", or "Add Admin"

### Creating Users

**Fields:**
- Full Name (required)
- Email (required, must be unique)
- Password (required, min 6 characters)
- Confirm Password (must match)
- Role (employee/manager/admin)
- Department (optional)
- Active Status (default: Active)
- Manager Assignment (only for employees)

**Validation:**
- Email uniqueness is enforced
- Password minimum length: 6 characters
- Required fields validation
- Manager assignment required for employees

### User Actions

| Action | Description |
|--------|-------------|
| Edit | Modify user details (password optional) |
| Reset Password | Generate new temporary password |
| Delete | Remove user from system |
| Activate/Deactivate | Enable or disable user access |

### User Table Columns

- Name
- Email
- Role (Admin/Manager/Employee badge)
- Department
- Manager (assigned manager name/email)
- Status (Active/Inactive badge)
- Actions (Edit, Reset Password, Delete)

---

## Backend API Endpoints

### Public Routes

- `POST /api/auth/login` - User login
- `POST /api/auth/seed-demo-users` - Initialize demo users (run once)

### Admin-Only Routes

**All protected routes require a JWT bearer token returned from login.**

#### User Management

- `POST /api/auth/admin/users` - Create user
- `GET /api/auth/admin/users` - List all users
- `GET /api/auth/admin/users/:id` - Get specific user
- `PUT /api/auth/admin/users/:id` - Update user
- `DELETE /api/auth/admin/users/:id` - Delete user
- `PUT /api/auth/admin/users/:id/reset-password` - Reset password

### Request Headers

```
Content-Type: application/json
Authorization: Bearer <login_token>
```

### Example: Create User

```bash
curl -X POST http://localhost:5000/api/auth/admin/users \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <login_token>" \
  -d '{
    "name": "John Doe",
    "email": "john@company.com",
    "password": "password123",
    "confirmPassword": "password123",
    "role": "employee",
    "department": "Engineering",
    "managerId": "<manager_id>",
    "isActive": true
  }'
```

---

## Database Schema

### User Collection

```javascript
{
  _id: ObjectId,
  name: String,                    // Full name
  email: String,                   // Unique email (lowercase)
  password: String,                // bcrypt hash
  role: String,                    // "admin" | "manager" | "employee"
  department: String,              // Optional department name
  managerId: ObjectId,             // Reference to manager (null for non-employees)
  isActive: Boolean,               // Account status (default: true)
  createdAt: Date,                 // Auto-generated
  updatedAt: Date                  // Auto-updated
}
```

---

## Security Notes

⚠️ **Production Considerations:**

1. **Password Hashing** - Passwords are hashed with bcrypt.
2. **HTTPS** - Always use HTTPS in production
3. **Environment Variables** - Store sensitive config in .env files
4. **API Authentication** - Consider JWT tokens instead of headers
5. **Rate Limiting** - Add rate limiting to prevent brute force attacks
6. **Input Validation** - Strengthen input validation on the backend
7. **CORS** - Configure CORS properly for production domains

---

## File Structure

```
Backend/
├── routes/
│   ├── authRoutes.js          # Login & admin user management
│   ├── goalRoutes.js
│   ├── updateRoutes.js
│   ├── auditRoutes.js
│   └── reportRoutes.js
├── models/
│   ├── User.js                # User schema with new fields
│   ├── Goal.js
│   ├── GoalUpdate.js
│   ├── SharedGoal.js
│   └── AuditLog.js
├── server.js
└── package.json

frontend/
├── login.html                 # Enterprise login page
├── employee.html
├── manager.html
├── admin.html                 # With user management section
├── js/
│   ├── login.js              # Login with demo buttons
│   ├── employee.js
│   ├── manager.js
│   ├── admin.js              # Dashboard initialization
│   └── admin-users.js        # User management module
└── css/
    ├── unified-styles.css    # Comprehensive enterprise styling
    └── alogin.css            # Additional login styling
```

---

## Features Implemented

### ✅ Completed

1. **Enhanced User Model** - Added department, isActive, timestamps, manager assignment
2. **Admin APIs** - Full CRUD operations for user management
3. **Login Page Redesign** - Modern enterprise UI with demo buttons
4. **Admin Dashboard** - User management section with responsive table
5. **User Management Modal** - Create/edit users with validation
6. **Demo Users Endpoint** - Seed demo accounts
7. **Unified Styling** - Consistent design across all pages
8. **Security** - Admin-only endpoint protection
9. **Audit Logging** - Admin actions logged

### 🔄 Future Enhancements

- Email notifications
- Password reset email feature
- User activity logging
- Two-factor authentication
- Role-based menu visibility
- Bulk user import (CSV)

---

## Troubleshooting

### "User not found" on login

- Verify demo users were created: `POST /api/auth/seed-demo-users`
- Check email is lowercase in database

### Users table empty

- Make sure admin is logged in with valid credentials
- Check browser console for API errors
- Verify backend is running on port 5000

### Password reset not working

- Ensure new password is at least 6 characters
- Confirm passwords match
- Check that user account is active

### Frontend can't reach backend

- Verify backend is running on `http://localhost:5000`
- Check CORS is enabled on backend
- Verify network connection

---

## Testing Workflow

1. **Demo Login** - Click "Admin Demo" on login page
2. **Create User** - Go to User Management → Add Employee
3. **Edit User** - Click edit icon next to user
4. **Reset Password** - Click reset icon
5. **Delete User** - Click trash icon
6. **Employee Login** - Logout and login as created employee
7. **Employee Dashboard** - Create/submit goals

---

## Support

For issues or questions:
1. Check the console (F12) for error messages
2. Verify all services are running (Backend, MongoDB)
3. Check network tab in browser DevTools
4. Review logs in terminal

---

## License

Enterprise Performance Management System

Created: 2024-2025
