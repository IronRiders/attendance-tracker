# ChainLynx Attendance System

A complete attendance tracking system with barcode scanning capabilities, designed for organizations that need to track member attendance and generate detailed reports.

## Features

### 🏢 Management Interface (Password Protected)
- Add, edit, and delete members
- Assign unique barcodes to each member
- Real-time member list management
- Barcode scanner integration for member registration

### 📊 Reports Interface (Password Protected)
- Generate attendance reports by date range
- View total hours worked by each member
- Calendar view showing attendance patterns
- Detailed attendance records with check-in/check-out times
- Filter reports by specific members
- Export functionality (CSV format)

### 📱 Kiosk Interface (Public)
- Simple, touch-friendly interface for attendance tracking
- Barcode scanner integration for quick check-in/check-out
- Real-time feedback for successful scans
- Display of recent activity
- Automatic check-in/check-out detection
- Manual ID entry option as fallback

### 🔐 Security Features
- Session-based authentication
- Password-protected admin areas
- Secure database storage
- Default admin credentials (changeable)

## Technology Stack

- **Backend**: Node.js with Express.js
- **Database**: SQLite3 (local file-based)
- **Frontend**: Vanilla HTML/CSS/JavaScript
- **Authentication**: bcrypt password hashing with sessions
- **Styling**: Custom CSS with responsive design

## Installation

1. **Clone or download the project files**

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Start the server**:
   ```bash
   npm start
   ```
   
   For development with auto-restart:
   ```bash
   npm run dev
   ```

4. **Access the application**:
   - Kiosk Interface: http://localhost:3000
   - Admin Login: http://localhost:3000/login
   - Management: http://localhost:3000/management (after login)
   - Reports: http://localhost:3000/reports (after login)

## Default Login Credentials

- **Username**: admin
- **Password**: admin123

*⚠️ Change these credentials in production by creating a new admin account and deleting the default one.*

## Usage Guide

### Setting Up Members

1. Navigate to the Management interface
2. Use the "Add New Member" form
3. Enter member details and scan/enter their barcode
4. The barcode will be used for attendance tracking

### Barcode Scanning

The system supports various barcode formats and can work with:
- USB barcode scanners (HID keyboard emulation)
- Manual barcode entry
- QR codes
- Any scannable identifier

### Taking Attendance

1. Members approach the kiosk interface
2. Scan their barcode or enter their ID manually
3. System automatically determines check-in vs check-out
4. Real-time feedback confirms the action
5. Recent activity is displayed on screen

### Generating Reports

1. Access the Reports interface
2. Select date range for the report
3. Optionally filter by specific member
4. View summary cards, calendar view, and detailed records
5. Export data to CSV if needed

## Automatic Logout System

### Overview
The system includes an automatic logout feature that helps ensure accurate attendance tracking by automatically checking out members who may have forgotten to scan out at the end of the day.

### Features
- **Configurable Time**: Set any time for daily automatic logout (default: 6:00 PM)
- **Smart Detection**: Only affects members currently checked in
- **Flagged Records**: All automatic logouts are flagged for review
- **Manual Override**: Admins can review and approve automatic logouts
- **Manual Trigger**: Test the system with a manual trigger button

### Configuration
1. Access the Management interface with admin credentials
2. Navigate to the "Auto-Logout Settings" section
3. Enable/disable the automatic logout feature
4. Set the desired logout time (24-hour format)
5. Save settings to apply changes

### Review Process
1. Access the Reports interface
2. View the "Records Requiring Review" section
3. Review flagged automatic logout records
4. Mark records as reviewed to maintain data integrity

The system automatically creates checkout records for all currently checked-in members at the specified time each day. These records are clearly marked as automatic logouts and require administrative review to ensure accuracy.

## Database Schema

### Members Table
- `id`: Primary key
- `name`: Member's full name
- `barcode`: Unique barcode/ID
- `created_at`: Registration timestamp

### Attendance Records Table
- `id`: Primary key
- `member_id`: Foreign key to members
- `scan_time`: Timestamp of scan
- `is_checkin`: Boolean (true=check-in, false=check-out)
- `is_auto_logout`: Boolean (true if automatically logged out)
- `needs_review`: Boolean (true if requires admin review)

### Admins Table
- `id`: Primary key
- `username`: Admin username
- `password_hash`: bcrypt hashed password
- `created_at`: Account creation timestamp

## Configuration

### Environment Variables (Optional)
- `PORT`: Server port (default: 3000)

### Session Configuration
Sessions are configured in `server.js`:
- Session secret: Change for production
- Session timeout: 24 hours default
- Secure cookies: Enable for HTTPS in production

## File Structure

```
chainlynx-attendance/
├── server.js              # Main server file
├── database.js            # Database operations
├── package.json           # Node.js dependencies
├── attendance.db          # SQLite database (created automatically)
├── public/
│   └── css/
│       └── style.css      # CSS styles
└── views/
    ├── kiosk.html         # Kiosk interface
    ├── login.html         # Admin login page
    ├── management.html    # Member management
    └── reports.html       # Reports interface
```

## API Endpoints

### Authentication
- `POST /login` - Admin login
- `POST /logout` - Admin logout

### Members Management (Protected)
- `GET /api/members` - Get all members
- `POST /api/members` - Add new member
- `PUT /api/members/:id` - Update member
- `DELETE /api/members/:id` - Delete member

### Attendance Tracking
- `POST /api/attendance/scan` - Record attendance scan
- `GET /api/attendance` - Get attendance records
- `GET /api/attendance/summary` - Get attendance summary

## Hardware Recommendations

### Barcode Scanners
- Any USB HID barcode scanner
- Recommended: Honeywell Voyager 1200g
- Handheld or hands-free models supported

### Kiosk Hardware
- Tablet or computer with web browser
- Touch screen recommended
- Network connection required
- Consider mounting solutions for fixed installations

## Security Considerations

1. **Change default admin credentials**
2. **Use HTTPS in production**
3. **Regular database backups**
4. **Network security for kiosk installations**
5. **Physical security for kiosk hardware**

## Troubleshooting

### Common Issues

**Barcode scanner not working**:
- Ensure scanner is in HID keyboard mode
- Test scanner in text editor first
- Check USB connection

**Database errors**:
- Ensure write permissions for database file
- Check disk space
- Restart server if needed

**Session issues**:
- Clear browser cache and cookies
- Check server logs for session errors

**Network connectivity**:
- Verify all devices can reach the server
- Check firewall settings
- Ensure proper IP address configuration

## Development

To modify or extend the system:

1. **Backend changes**: Modify `server.js` and `database.js`
2. **Frontend changes**: Update HTML files in `views/`
3. **Styling**: Modify `public/css/style.css`
4. **Database schema**: Add migrations to `database.js`

### Adding Features

The system is designed to be extensible. Consider these enhancements:
- Photo capture during check-in
- Integration with HR systems
- Email notifications
- Advanced reporting features
- Multi-location support
- Mobile app companion

## License

This project is licensed under the ISC License - see the package.json file for details.

## Support

For support and questions:
1. Check this README for common solutions
2. Review server logs for error messages
3. Test with default credentials and sample data
4. Verify hardware compatibility

---

**Version**: 1.0.0  
**Last Updated**: September 2025
