const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const bcrypt = require('bcrypt');
const moment = require('moment');
const cron = require('node-cron');
const rateLimit = require('express-rate-limit');
require('dotenv').config();
const Database = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const db = new Database();

// Meeting-end auto-logout scheduler
let meetingSchedulers = {};

// Initialize meeting-end auto-logout scheduler
function initializeMeetingScheduler() {
    // Clear existing schedulers
    Object.values(meetingSchedulers).forEach(scheduler => scheduler.stop());
    meetingSchedulers = {};

    // Get meeting schedules and set up end-time logout schedulers
    db.getMeetingSchedules((err, schedules) => {
        if (err) {
            console.error('Error getting meeting schedules:', err);
            return;
        }

        schedules.forEach(schedule => {
            const { day_of_week, session_number, end_time } = schedule;
            const [hour, minute] = end_time.split(':').map(Number);
            
            // Add 15 minutes to the end time for auto-logout
            let logoutMinute = minute + 15;
            let logoutHour = hour;
            
            // Handle minute overflow
            if (logoutMinute >= 60) {
                logoutMinute -= 60;
                logoutHour += 1;
            }
            
            // Handle hour overflow (past midnight)
            if (logoutHour >= 24) {
                logoutHour -= 24;
            }
            
            const cronExpression = `${logoutMinute} ${logoutHour} * * ${day_of_week}`;
            const logoutTime = `${String(logoutHour).padStart(2, '0')}:${String(logoutMinute).padStart(2, '0')}`;
            
            const schedulerId = `${day_of_week}-${session_number}`;
            console.log(`Meeting end auto-logout scheduled for day ${day_of_week}, session ${session_number} at ${logoutTime} (15 minutes after meeting end at ${end_time})`);
            
            meetingSchedulers[schedulerId] = cron.schedule(cronExpression, () => {
                performMeetingEndLogout();
            });
        });
    });
}

// Perform automatic logout when meeting ends
function performMeetingEndLogout() {
    console.log('Performing meeting-end automatic logout...');
    
    db.getCurrentlyCheckedInMembers((err, checkedInMembers) => {
        if (err) {
            console.error('Error getting checked-in members:', err);
            return;
        }

        if (checkedInMembers.length === 0) {
            console.log('No members currently checked in - no auto-logout needed');
            return;
        }

        let processed = 0;
        let errors = 0;

        checkedInMembers.forEach(member => {
            db.recordAutoLogout(member.id, (err) => {
                processed++;
                if (err) {
                    errors++;
                    console.error(`Error auto-logging out ${member.name}:`, err);
                } else {
                    console.log(`Meeting-end auto-logged out: ${member.name} (${member.barcode})`);
                }

                // Log summary when all members are processed
                if (processed === checkedInMembers.length) {
                    console.log(`Meeting-end auto-logout completed: ${processed - errors} successful, ${errors} errors`);
                }
            });
        });
    });
}

// Initialize scheduler on startup
setTimeout(() => {
    initializeMeetingScheduler();
}, 1000); // Small delay to ensure database is ready

// Middleware
app.use(express.static('public'));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Security headers
app.use((req, res, next) => {
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    next();
});

// Rate limiting for authentication routes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // limit each IP to 5 requests per windowMs
    message: 'Too many login attempts, please try again later.',
    standardHeaders: true,
    legacyHeaders: false,
});

// Session configuration
app.use(session({
    secret: process.env.SESSION_SECRET || 'attendance-system-secret-' + Math.random(),
    resave: false,
    saveUninitialized: false,
    name: 'attendance_session',
    cookie: { 
        secure: false, // Set to true in production with HTTPS
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        sameSite: 'strict'
    }
}));

// Authentication middleware
const requireAuth = (req, res, next) => {
    if (req.session && req.session.authenticated) {
        // Regenerate session ID to prevent session fixation
        if (!req.session.regenerated) {
            req.session.regenerate((err) => {
                if (err) {
                    console.error('Session regeneration error:', err);
                }
                req.session.authenticated = true;
                req.session.regenerated = true;
                next();
            });
        } else {
            next();
        }
    } else {
        // Clear any potentially corrupted session
        if (req.session) {
            req.session.destroy();
        }
        if (req.xhr || req.headers.accept && req.headers.accept.indexOf('json') > -1) {
            // Return JSON for API requests
            res.status(401).json({ error: 'Authentication required' });
        } else {
            // Redirect to login for page requests
            res.redirect('/login');
        }
    }
};

// Routes
// Home page - redirect to kiosk
app.get('/', (req, res) => {
    // Auto-logout any admin session when accessing kiosk
    if (req.session && req.session.authenticated) {
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session on kiosk access:', err);
            }
            res.clearCookie('attendance_session');
            res.redirect('/kiosk?logout=auto');
        });
    } else {
        res.sendFile(path.join(__dirname, 'views/kiosk.html'));
    }
});

// Kiosk interface
app.get('/kiosk', (req, res) => {
    // Auto-logout any admin session when accessing kiosk
    if (req.session && req.session.authenticated) {
        req.session.destroy((err) => {
            if (err) {
                console.error('Error destroying session on kiosk access:', err);
            }
            res.clearCookie('attendance_session');
            res.redirect('/kiosk?logout=auto');
        });
    } else {
        res.sendFile(path.join(__dirname, 'views/kiosk.html'));
    }
});

// Login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/login.html'));
});

// Login POST
app.post('/login', authLimiter, async (req, res) => {
    const { username, password } = req.body;
    
    // Input validation
    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password are required' });
    }
    
    if (typeof username !== 'string' || typeof password !== 'string') {
        return res.status(400).json({ error: 'Invalid input format' });
    }
    
    // Trim and validate length
    const cleanUsername = username.trim();
    if (cleanUsername.length === 0 || cleanUsername.length > 50) {
        return res.status(400).json({ error: 'Invalid username length' });
    }
    
    if (password.length === 0 || password.length > 100) {
        return res.status(400).json({ error: 'Invalid password length' });
    }
    
    db.getAdminByUsername(cleanUsername, async (err, admin) => {
        if (err || !admin) {
            // Use a consistent delay to prevent timing attacks
            await new Promise(resolve => setTimeout(resolve, 1000));
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        try {
            const isValid = await bcrypt.compare(password, admin.password_hash);
            if (isValid) {
                // Regenerate session to prevent session fixation
                req.session.regenerate((err) => {
                    if (err) {
                        return res.status(500).json({ error: 'Login failed' });
                    }
                    req.session.authenticated = true;
                    req.session.username = cleanUsername;
                    req.session.loginTime = Date.now();
                    res.json({ success: true });
                });
            } else {
                await new Promise(resolve => setTimeout(resolve, 1000));
                res.status(401).json({ error: 'Invalid credentials' });
            }
        } catch (error) {
            console.error('Login error:', error);
            res.status(500).json({ error: 'Login failed' });
        }
    });
});

// Logout
app.post('/logout', (req, res) => {
    if (req.session) {
        req.session.destroy((err) => {
            if (err) {
                console.error('Logout error:', err);
                return res.status(500).json({ error: 'Logout failed' });
            }
            res.clearCookie('attendance_session');
            res.json({ success: true });
        });
    } else {
        res.json({ success: true });
    }
});

// Management interface
app.get('/management', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views/management.html'));
});

// Reports interface
app.get('/reports', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views/reports.html'));
});

// API Routes

// Members API
app.get('/api/members', requireAuth, (req, res) => {
    db.getAllMembers((err, members) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json(members);
        }
    });
});

app.post('/api/members', requireAuth, (req, res) => {
    const { name, barcode } = req.body;
    
    if (!name || !barcode) {
        return res.status(400).json({ error: 'Name and barcode are required' });
    }
    
    db.addMember(name, barcode, function(err) {
        if (err) {
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                res.status(400).json({ error: 'Barcode already exists' });
            } else {
                res.status(500).json({ error: 'Database error' });
            }
        } else {
            res.json({ success: true, id: this.lastID });
        }
    });
});

app.put('/api/members/:id', requireAuth, (req, res) => {
    const { name, barcode } = req.body;
    const id = req.params.id;
    
    console.log('PUT /api/members/:id - ID:', id, 'Body:', req.body);
    
    if (!name || !barcode) {
        return res.status(400).json({ error: 'Name and barcode are required' });
    }
    
    db.updateMember(id, name, barcode, (err) => {
        if (err) {
            console.error('Database error updating member:', err);
            if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                res.status(400).json({ error: 'Barcode already exists' });
            } else {
                res.status(500).json({ error: 'Database error: ' + err.message });
            }
        } else {
            res.json({ success: true });
        }
    });
});

app.delete('/api/members/:id', requireAuth, (req, res) => {
    const id = req.params.id;
    
    db.deleteMember(id, (err) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json({ success: true });
        }
    });
});

// Attendance API
app.post('/api/attendance/scan', (req, res) => {
    const { barcode } = req.body;
    
    if (!barcode) {
        return res.status(400).json({ error: 'Barcode is required' });
    }
    
    // First, find the member by barcode
    db.getMemberByBarcode(barcode, (err, member) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (!member) {
            return res.status(404).json({ error: 'Member not found' });
        }
        
        // Get the last scan to determine if this is check-in or check-out
        db.getLastScanForMember(member.id, (err, lastScan) => {
            if (err) {
                return res.status(500).json({ error: 'Database error' });
            }
            
            // If no previous scan or last scan was check-out, this is a check-in
            const isCheckin = !lastScan || !lastScan.is_checkin;
            
            // If this is a check-in, verify meeting schedule
            if (isCheckin) {
                db.isWithinMeetingSchedule((err, activeSession) => {
                    if (err) {
                        return res.status(500).json({ error: 'Database error checking schedule' });
                    }
                    
                    if (!activeSession) {
                        // Not within any meeting session, get next session info
                        db.getNextMeetingSession((err, nextSession) => {
                            if (err) {
                                return res.status(500).json({ error: 'Database error' });
                            }
                            
                            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                            let message = 'Check-in not allowed outside meeting sessions.';
                            
                            if (nextSession) {
                                const dayName = dayNames[nextSession.day];
                                message = `Check-in not allowed. Next session: ${dayName} ${nextSession.start}-${nextSession.end}`;
                            }
                            
                            return res.status(403).json({ 
                                error: message,
                                nextSession: nextSession ? {
                                    day: dayNames[nextSession.day],
                                    startTime: nextSession.start,
                                    endTime: nextSession.end
                                } : null
                            });
                        });
                        return;
                    }
                    
                    // Within meeting session, proceed with check-in
                    recordAttendanceWithSession(member, isCheckin, activeSession, res);
                });
            } else {
                // Check-out is always allowed
                recordAttendanceWithSession(member, isCheckin, null, res);
            }
        });
    });
});

// Helper function to record attendance with session info
function recordAttendanceWithSession(member, isCheckin, session, res) {
    let needsReview = false;
    
    // Check if this is a check-in within the last 5 minutes of a meeting session
    if (isCheckin && session) {
        const now = new Date();
        const currentTime = now.getHours() * 60 + now.getMinutes(); // Current time in minutes from midnight
        const [endHour, endMinute] = session.end_time.split(':').map(Number);
        const sessionEndTime = endHour * 60 + endMinute; // Session end time in minutes from midnight
        
        // If check-in is within 5 minutes (300 seconds) of session end, flag for review
        const minutesUntilEnd = sessionEndTime - currentTime;
        if (minutesUntilEnd <= 5 && minutesUntilEnd >= 0) {
            needsReview = true;
        }
    }
    
    db.recordAttendance(member.id, isCheckin, needsReview, (err) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        const response = {
            success: true,
            member: member,
            action: isCheckin ? 'check-in' : 'check-out',
            timestamp: new Date().toISOString()
        };
        
        if (session && isCheckin) {
            response.session = {
                number: session.session_number,
                startTime: session.start_time,
                endTime: session.end_time
            };
            
            if (needsReview) {
                response.flaggedForReview = true;
                response.reason = 'Check-in within 5 minutes of session end';
            }
        }
        
        res.json(response);
    });
}

app.get('/api/attendance', requireAuth, (req, res) => {
    const { startDate, endDate, memberId } = req.query;
    
    if (memberId) {
        db.getAttendanceByMember(memberId, (err, records) => {
            if (err) {
                res.status(500).json({ error: 'Database error' });
            } else {
                res.json(records);
            }
        });
    } else if (startDate && endDate) {
        db.getAttendanceByDateRange(startDate, endDate, (err, records) => {
            if (err) {
                res.status(500).json({ error: 'Database error' });
            } else {
                res.json(records);
            }
        });
    } else {
        db.getAttendanceRecords((err, records) => {
            if (err) {
                res.status(500).json({ error: 'Database error' });
            } else {
                res.json(records);
            }
        });
    }
});

// Get attendance summary for reports
app.get('/api/attendance/summary', requireAuth, (req, res) => {
    const { startDate, endDate } = req.query;
    const start = startDate || moment().startOf('month').format('YYYY-MM-DD');
    const end = endDate || moment().endOf('month').format('YYYY-MM-DD');
    
    db.getAttendanceByDateRange(start, end, (err, records) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        // Process records to calculate hours and summary
        const summary = {};
        records.forEach(record => {
            const memberId = record.member_id;
            if (!summary[memberId]) {
                summary[memberId] = {
                    name: record.name,
                    totalHours: 0,
                    daysPresent: new Set(),
                    sessions: []
                };
            }
            
            const date = moment(record.scan_time).format('YYYY-MM-DD');
            summary[memberId].daysPresent.add(date);
        });
        
        // Calculate hours for each member
        Object.keys(summary).forEach(memberId => {
            const memberRecords = records.filter(r => r.member_id == memberId);
            let totalHours = 0;
            
            // Group by date and calculate daily hours
            const dailyRecords = {};
            memberRecords.forEach(record => {
                const date = moment(record.scan_time).format('YYYY-MM-DD');
                if (!dailyRecords[date]) {
                    dailyRecords[date] = [];
                }
                dailyRecords[date].push(record);
            });
            
            Object.keys(dailyRecords).forEach(date => {
                const dayRecords = dailyRecords[date].sort((a, b) => 
                    new Date(a.scan_time) - new Date(b.scan_time));
                
                // Pair check-ins with check-outs
                for (let i = 0; i < dayRecords.length - 1; i += 2) {
                    if (dayRecords[i].is_checkin && !dayRecords[i + 1].is_checkin) {
                        const checkinTime = moment(dayRecords[i].scan_time);
                        const checkoutTime = moment(dayRecords[i + 1].scan_time);
                        const duration = moment.duration(checkoutTime.diff(checkinTime));
                        totalHours += duration.asHours();
                    }
                }
            });
            
            summary[memberId].totalHours = Math.round(totalHours * 100) / 100;
            summary[memberId].daysPresent = Array.from(summary[memberId].daysPresent);
        });
        
        res.json(summary);
    });
});

// Get currently checked-in members (public endpoint for kiosk)
app.get('/api/currently-checked-in', (req, res) => {
    console.log('API call: getting currently checked-in members');
    db.getCurrentlyCheckedInMembers((err, checkedInMembers) => {
        if (err) {
            console.error('Error getting checked-in members:', err);
            res.status(500).json({ error: 'Database error' });
        } else {
            console.log('Currently checked-in members:', checkedInMembers);
            res.json(checkedInMembers);
        }
    });
});


// Flagged records API
app.get('/api/flagged-records', requireAuth, (req, res) => {
    db.getFlaggedRecords((err, records) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json(records);
        }
    });
});

app.put('/api/flagged-records/:id/review', requireAuth, (req, res) => {
    const recordId = req.params.id;
    
    db.markRecordAsReviewed(recordId, (err) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json({ success: true });
        }
    });
});

// Manual trigger for auto-logout (for testing)
app.post('/api/trigger-auto-logout', requireAuth, (req, res) => {
    performAutoLogout();
    res.json({ success: true, message: 'Auto-logout triggered manually' });
});

// Meeting Schedule API
app.get('/api/meeting-schedules', requireAuth, (req, res) => {
    db.getMeetingSchedules((err, schedules) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else {
            res.json(schedules);
        }
    });
});

app.get('/api/meeting-schedules/current', (req, res) => {
    db.isWithinMeetingSchedule((err, activeSession) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (activeSession) {
            res.json({
                active: true,
                session: activeSession
            });
        } else {
            db.getNextMeetingSession((err, nextSession) => {
                res.json({
                    active: false,
                    nextSession: nextSession || null
                });
            });
        }
    });
});

app.put('/api/meeting-schedules', requireAuth, (req, res) => {
    const { schedules } = req.body;
    
    if (!Array.isArray(schedules)) {
        return res.status(400).json({ error: 'Schedules must be an array' });
    }
    
    // Get all current schedules to determine what needs to be deleted
    db.getMeetingSchedules((err, currentSchedules) => {
        if (err) {
            return res.status(500).json({ error: 'Error getting current schedules' });
        }
        
        // Find schedules that exist in database but not in the new list (need to delete)
        const newScheduleKeys = new Set(schedules.map(s => `${s.dayOfWeek}-${s.sessionNumber}`));
        const schedulesToDelete = currentSchedules.filter(current => 
            !newScheduleKeys.has(`${current.day_of_week}-${current.session_number}`)
        );
        
        let totalOperations = schedules.length + schedulesToDelete.length;
        let completed = 0;
        let errors = 0;
        
        // Function to check if all operations are complete
        const checkComplete = () => {
            completed++;
            if (completed === totalOperations) {
                if (errors === 0) {
                    // Reinitialize the scheduler with the new schedules
                    initializeMeetingScheduler();
                    res.json({ success: true, message: 'Meeting schedules updated successfully' });
                } else {
                    res.status(500).json({ error: 'Error updating some schedules' });
                }
            }
        };
        
        // If no operations needed, return success immediately
        if (totalOperations === 0) {
            initializeMeetingScheduler();
            return res.json({ success: true, message: 'No changes needed' });
        }
        
        // Delete schedules that are no longer present
        schedulesToDelete.forEach(schedule => {
            db.deleteMeetingSchedule(schedule.day_of_week, schedule.session_number, (err) => {
                if (err) {
                    errors++;
                    console.error('Error deleting schedule:', err);
                } else {
                    console.log(`Deleted schedule for day ${schedule.day_of_week}, session ${schedule.session_number}`);
                }
                checkComplete();
            });
        });
        
        // Update/insert the new schedules
        schedules.forEach(schedule => {
            const { dayOfWeek, sessionNumber, startTime, endTime, sessionName } = schedule;
            
            db.updateMeetingSchedule(dayOfWeek, sessionNumber, startTime, endTime, sessionName, (err) => {
                if (err) {
                    errors++;
                    console.error('Error updating schedule:', err);
                }
                checkComplete();
            });
        });
    });
});

app.delete('/api/meeting-schedules/:day/:session', requireAuth, (req, res) => {
    const dayOfWeek = parseInt(req.params.day);
    const sessionNumber = parseInt(req.params.session);
    
    db.deleteMeetingSchedule(dayOfWeek, sessionNumber, (err) => {
        if (err) {
            res.status(500).json({ error: 'Database error' });
        } else {
            // Remove the specific cron job for this session
            const schedulerId = `${dayOfWeek}-${sessionNumber}`;
            if (meetingSchedulers[schedulerId]) {
                meetingSchedulers[schedulerId].stop();
                delete meetingSchedulers[schedulerId];
                console.log(`Removed auto-logout scheduler for day ${dayOfWeek}, session ${sessionNumber}`);
            }
            
            res.json({ success: true, message: 'Session deleted and auto-logout removed' });
        }
    });
});

// Refresh meeting schedules - reinitialize scheduler
app.post('/api/meeting-schedules/refresh', requireAuth, (req, res) => {
    try {
        initializeMeetingScheduler();
        res.json({ success: true, message: 'Meeting scheduler refreshed' });
    } catch (error) {
        console.error('Error refreshing meeting scheduler:', error);
        res.status(500).json({ error: 'Failed to refresh scheduler' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Admin credentials loaded from environment variables: username=${process.env.ADMIN_USERNAME || 'admin'}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    db.close();
    process.exit(0);
});
