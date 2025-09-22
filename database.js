const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

class Database {
    constructor() {
        this.db = new sqlite3.Database('attendance.db');
        this.init();
    }

    init() {
        // Create members table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                barcode TEXT UNIQUE NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create attendance_records table
        this.db.run(`
            CREATE TABLE IF NOT EXISTS attendance_records (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                member_id INTEGER,
                scan_time DATETIME DEFAULT CURRENT_TIMESTAMP,
                is_checkin BOOLEAN DEFAULT true,
                FOREIGN KEY (member_id) REFERENCES members (id)
            )
        `, (err) => {
            if (!err) {
                this.runMigrations();
            }
        });

        // Create admins table for authentication
        this.db.run(`
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (!err) {
                this.createDefaultAdmin();
            }
        });

        // Create settings table for system configuration
        this.db.run(`
            CREATE TABLE IF NOT EXISTS settings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                setting_key TEXT UNIQUE NOT NULL,
                setting_value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `, (err) => {
            if (!err) {
                this.createDefaultSettings();
            }
        });

        // Create meeting_schedules table for session-based sign-in windows
        this.db.run(`
            CREATE TABLE IF NOT EXISTS meeting_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                day_of_week INTEGER NOT NULL,
                session_number INTEGER NOT NULL,
                start_time TEXT NOT NULL,
                end_time TEXT NOT NULL,
                is_active BOOLEAN DEFAULT true,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(day_of_week, session_number)
            )
        `, (err) => {
            if (!err) {
                this.createDefaultMeetingSchedules();
            }
        });
    }

    // Database migration system
    runMigrations() {
        this.db.get("PRAGMA table_info(attendance_records)", (err, rows) => {
            if (err) {
                console.error('Error checking table structure:', err);
                return;
            }

            // Check if we need to add the new columns
            this.db.all("PRAGMA table_info(attendance_records)", (err, columns) => {
                if (err) {
                    console.error('Error getting column info:', err);
                    return;
                }

                const hasAutoLogout = columns.some(col => col.name === 'is_auto_logout');
                const hasNeedsReview = columns.some(col => col.name === 'needs_review');

                if (!hasAutoLogout) {
                    this.db.run("ALTER TABLE attendance_records ADD COLUMN is_auto_logout BOOLEAN DEFAULT false", (err) => {
                        if (err) {
                            console.error('Error adding is_auto_logout column:', err);
                        } else {
                            console.log('Added is_auto_logout column to attendance_records table');
                        }
                    });
                }

                if (!hasNeedsReview) {
                    this.db.run("ALTER TABLE attendance_records ADD COLUMN needs_review BOOLEAN DEFAULT false", (err) => {
                        if (err) {
                            console.error('Error adding needs_review column:', err);
                        } else {
                            console.log('Added needs_review column to attendance_records table');
                        }
                    });
                }
            });
        });

        // Check meeting_schedules table for session_name column
        this.db.all("PRAGMA table_info(meeting_schedules)", (err, columns) => {
            if (err) {
                console.error('Error getting meeting_schedules column info:', err);
                return;
            }

            const hasSessionName = columns.some(col => col.name === 'session_name');

            if (!hasSessionName) {
                this.db.run("ALTER TABLE meeting_schedules ADD COLUMN session_name TEXT", (err) => {
                    if (err) {
                        console.error('Error adding session_name column:', err);
                    } else {
                        console.log('Added session_name column to meeting_schedules table');
                        // Set default session names for existing records
                        this.db.run("UPDATE meeting_schedules SET session_name = 'Session ' || session_number WHERE session_name IS NULL", (err) => {
                            if (err) {
                                console.error('Error setting default session names:', err);
                            } else {
                                console.log('Set default session names for existing records');
                            }
                        });
                    }
                });
            }
        });
    }

    async createDefaultAdmin() {
        const defaultUsername = 'admin';
        const defaultPassword = 'admin123';
        
        // Check if admin already exists
        this.db.get('SELECT * FROM admins WHERE username = ?', [defaultUsername], async (err, row) => {
            if (!row) {
                const hashedPassword = await bcrypt.hash(defaultPassword, 10);
                this.db.run('INSERT INTO admins (username, password_hash) VALUES (?, ?)', 
                    [defaultUsername, hashedPassword]);
                console.log(`Default admin created: username=${defaultUsername}, password=${defaultPassword}`);
            }
        });
    }

    createDefaultSettings() {
        // Weekly auto-logout schedule (JSON format)
        const defaultSchedule = JSON.stringify({
            monday: '18:00',
            tuesday: '18:00',
            wednesday: '18:00',
            thursday: '18:00',
            friday: '18:00',
            saturday: '',
            sunday: ''
        });
        
        this.db.get('SELECT * FROM settings WHERE setting_key = ?', ['weekly_auto_logout_schedule'], (err, row) => {
            if (!row) {
                this.db.run('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)', 
                    ['weekly_auto_logout_schedule', defaultSchedule]);
                console.log('Default weekly auto-logout schedule created');
            }
        });

        // Enable auto-logout by default
        this.db.get('SELECT * FROM settings WHERE setting_key = ?', ['auto_logout_enabled'], (err, row) => {
            if (!row) {
                this.db.run('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?)', 
                    ['auto_logout_enabled', 'true']);
            }
        });

        // Migration: Convert old single time setting to weekly schedule
        this.db.get('SELECT * FROM settings WHERE setting_key = ?', ['auto_logout_time'], (err, row) => {
            if (!err && row) {
                const singleTime = row.setting_value;
                const weeklySchedule = JSON.stringify({
                    monday: singleTime,
                    tuesday: singleTime,
                    wednesday: singleTime,
                    thursday: singleTime,
                    friday: singleTime,
                    saturday: '',
                    sunday: ''
                });
                
                this.db.run('UPDATE settings SET setting_value = ? WHERE setting_key = ?', 
                    [weeklySchedule, 'weekly_auto_logout_schedule']);
                
                // Remove old setting
                this.db.run('DELETE FROM settings WHERE setting_key = ?', ['auto_logout_time']);
                console.log('Migrated single auto-logout time to weekly schedule');
            }
        });
    }

    createDefaultMeetingSchedules() {
        // Create default meeting schedules - can be customized later
        const defaultSchedules = [
            // Monday through Friday - 3 sessions per day
            { day: 1, session: 1, start: '08:00', end: '12:00' }, // Monday Session 1
            { day: 1, session: 2, start: '13:00', end: '17:00' }, // Monday Session 2
            { day: 1, session: 3, start: '18:00', end: '21:00' }, // Monday Session 3
            
            { day: 2, session: 1, start: '08:00', end: '12:00' }, // Tuesday Session 1
            { day: 2, session: 2, start: '13:00', end: '17:00' }, // Tuesday Session 2
            { day: 2, session: 3, start: '18:00', end: '21:00' }, // Tuesday Session 3
            
            { day: 3, session: 1, start: '08:00', end: '12:00' }, // Wednesday Session 1
            { day: 3, session: 2, start: '13:00', end: '17:00' }, // Wednesday Session 2
            { day: 3, session: 3, start: '18:00', end: '21:00' }, // Wednesday Session 3
            
            { day: 4, session: 1, start: '08:00', end: '12:00' }, // Thursday Session 1
            { day: 4, session: 2, start: '13:00', end: '17:00' }, // Thursday Session 2
            { day: 4, session: 3, start: '18:00', end: '21:00' }, // Thursday Session 3
            
            { day: 5, session: 1, start: '08:00', end: '12:00' }, // Friday Session 1
            { day: 5, session: 2, start: '13:00', end: '17:00' }, // Friday Session 2
            { day: 5, session: 3, start: '18:00', end: '21:00' }, // Friday Session 3
        ];

        // Only create if no schedules exist
        this.db.get('SELECT COUNT(*) as count FROM meeting_schedules', (err, row) => {
            if (!err && row.count === 0) {
                defaultSchedules.forEach(schedule => {
                    this.db.run(
                        'INSERT INTO meeting_schedules (day_of_week, session_number, start_time, end_time) VALUES (?, ?, ?, ?)',
                        [schedule.day, schedule.session, schedule.start, schedule.end]
                    );
                });
                console.log('Default meeting schedules created');
            }
        });
    }

    // Member operations
    addMember(name, barcode, callback) {
        this.db.run('INSERT INTO members (name, barcode) VALUES (?, ?)', 
            [name, barcode], callback);
    }

    getAllMembers(callback) {
        this.db.all('SELECT * FROM members ORDER BY name', callback);
    }

    getMemberByBarcode(barcode, callback) {
        this.db.get('SELECT * FROM members WHERE barcode = ?', [barcode], callback);
    }

    deleteMember(id, callback) {
        console.log(`Attempting to delete member with ID: ${id}`);
        
        // First check if member has attendance records
        this.db.get('SELECT COUNT(*) as count FROM attendance_records WHERE member_id = ?', [id], (err, row) => {
            if (err) {
                console.error('Error checking attendance records:', err);
                return callback(err);
            }
            
            console.log(`Member ${id} has ${row.count} attendance records`);
            
            if (row.count > 0) {
                // Delete attendance records first
                this.db.run('DELETE FROM attendance_records WHERE member_id = ?', [id], (err) => {
                    if (err) {
                        console.error('Error deleting attendance records:', err);
                        return callback(err);
                    }
                    
                    console.log(`Deleted ${row.count} attendance records for member ${id}`);
                    
                    // Now delete the member
                    this.db.run('DELETE FROM members WHERE id = ?', [id], (err) => {
                        if (err) {
                            console.error('Error deleting member:', err);
                        } else {
                            console.log(`Successfully deleted member ${id}`);
                        }
                        callback(err);
                    });
                });
            } else {
                // No attendance records, delete member directly
                this.db.run('DELETE FROM members WHERE id = ?', [id], (err) => {
                    if (err) {
                        console.error('Error deleting member:', err);
                    } else {
                        console.log(`Successfully deleted member ${id}`);
                    }
                    callback(err);
                });
            }
        });
    }

    updateMember(id, name, barcode, callback) {
        this.db.run('UPDATE members SET name = ?, barcode = ? WHERE id = ?',
            [name, barcode, id], callback);
    }

    // Attendance operations
    recordAttendance(memberId, isCheckin, needsReview = false, callback) {
        this.db.run('INSERT INTO attendance_records (member_id, is_checkin, needs_review) VALUES (?, ?, ?)',
            [memberId, isCheckin, needsReview], callback);
    }

    recordAutoLogout(memberId, callback) {
        this.db.run('INSERT INTO attendance_records (member_id, is_checkin, is_auto_logout, needs_review) VALUES (?, ?, ?, ?)',
            [memberId, false, true, true], callback);
    }

    getAttendanceRecords(callback) {
        this.db.all(`
            SELECT ar.*, m.name, m.barcode 
            FROM attendance_records ar 
            JOIN members m ON ar.member_id = m.id 
            ORDER BY ar.scan_time DESC
        `, callback);
    }

    // Get members who are currently checked in (last scan was check-in)
    getCurrentlyCheckedInMembers(callback) {
        // First check if there are any attendance records at all
        this.db.get('SELECT COUNT(*) as count FROM attendance_records', (err, result) => {
            if (err) {
                return callback(err);
            }
            
            // If no attendance records exist, return empty array
            if (result.count === 0) {
                return callback(null, []);
            }
            
            // If records exist, run the main query
            this.db.all(`
                SELECT DISTINCT m.id, m.name, ar.scan_time as last_checkin
                FROM members m
                JOIN attendance_records ar ON m.id = ar.member_id
                WHERE ar.id = (
                    SELECT MAX(id) 
                    FROM attendance_records ar2 
                    WHERE ar2.member_id = m.id
                ) AND ar.is_checkin = 1
                ORDER BY ar.scan_time DESC
            `, callback);
        });
    }

    // Get flagged records that need review
    getFlaggedRecords(callback) {
        this.db.all(`
            SELECT ar.*, m.name, m.barcode 
            FROM attendance_records ar 
            JOIN members m ON ar.member_id = m.id 
            WHERE ar.needs_review = 1
            ORDER BY ar.scan_time DESC
        `, callback);
    }

    // Mark a flagged record as reviewed
    markRecordAsReviewed(recordId, callback) {
        this.db.run('UPDATE attendance_records SET needs_review = 0 WHERE id = ?', [recordId], callback);
    }

    getAttendanceByMember(memberId, callback) {
        this.db.all(`
            SELECT ar.*, m.name, m.barcode 
            FROM attendance_records ar 
            JOIN members m ON ar.member_id = m.id 
            WHERE ar.member_id = ? 
            ORDER BY ar.scan_time DESC
        `, [memberId], callback);
    }

    getAttendanceByDateRange(startDate, endDate, callback) {
        this.db.all(`
            SELECT ar.*, m.name, m.barcode 
            FROM attendance_records ar 
            JOIN members m ON ar.member_id = m.id 
            WHERE DATE(ar.scan_time) BETWEEN ? AND ? 
            ORDER BY ar.scan_time DESC
        `, [startDate, endDate], callback);
    }

    // Get last scan for a member to determine if they're checking in or out
    getLastScanForMember(memberId, callback) {
        this.db.get(`
            SELECT * FROM attendance_records 
            WHERE member_id = ? 
            ORDER BY scan_time DESC 
            LIMIT 1
        `, [memberId], callback);
    }

    // Authentication operations
    getAdminByUsername(username, callback) {
        this.db.get('SELECT * FROM admins WHERE username = ?', [username], callback);
    }

    // Settings operations
    getSetting(key, callback) {
        this.db.get('SELECT * FROM settings WHERE setting_key = ?', [key], callback);
    }

    updateSetting(key, value, callback) {
        this.db.run(`
            INSERT OR REPLACE INTO settings (setting_key, setting_value, updated_at) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
        `, [key, value], callback);
    }

    getAllSettings(callback) {
        this.db.all('SELECT * FROM settings', callback);
    }

    // Meeting schedule operations
    getMeetingSchedules(callback) {
        this.db.all('SELECT * FROM meeting_schedules WHERE is_active = true ORDER BY day_of_week, session_number', callback);
    }

    getMeetingScheduleForDay(dayOfWeek, callback) {
        this.db.all('SELECT * FROM meeting_schedules WHERE day_of_week = ? AND is_active = true ORDER BY session_number', [dayOfWeek], callback);
    }

    updateMeetingSchedule(dayOfWeek, sessionNumber, startTime, endTime, sessionName, callback) {
        this.db.run(`
            INSERT OR REPLACE INTO meeting_schedules (day_of_week, session_number, start_time, end_time, session_name, is_active) 
            VALUES (?, ?, ?, ?, ?, true)
        `, [dayOfWeek, sessionNumber, startTime, endTime, sessionName || `Session ${sessionNumber}`], callback);
    }

    deleteMeetingSchedule(dayOfWeek, sessionNumber, callback) {
        this.db.run('UPDATE meeting_schedules SET is_active = false WHERE day_of_week = ? AND session_number = ?', 
            [dayOfWeek, sessionNumber], callback);
    }

    // Check if current time is within any active meeting session
    isWithinMeetingSchedule(callback) {
        const now = new Date();
        const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
        const currentTime = now.toTimeString().substring(0, 5); // HH:MM format
        
        this.db.get(`
            SELECT * FROM meeting_schedules 
            WHERE day_of_week = ? 
            AND is_active = true 
            AND start_time <= ? 
            AND end_time >= ?
        `, [dayOfWeek, currentTime, currentTime], callback);
    }

    // Get next available meeting session
    getNextMeetingSession(callback) {
        const now = new Date();
        const dayOfWeek = now.getDay();
        const currentTime = now.toTimeString().substring(0, 5);
        
        // First try to find a session today that hasn't started yet
        this.db.get(`
            SELECT *, day_of_week as day, session_number as session, start_time as start, end_time as end
            FROM meeting_schedules 
            WHERE day_of_week = ? 
            AND is_active = true 
            AND start_time > ?
            ORDER BY start_time
            LIMIT 1
        `, [dayOfWeek, currentTime], (err, todaySession) => {
            if (!err && todaySession) {
                return callback(null, todaySession);
            }
            
            // If no session today, find the next session in the week
            this.db.get(`
                SELECT *, day_of_week as day, session_number as session, start_time as start, end_time as end
                FROM meeting_schedules 
                WHERE ((day_of_week > ? AND day_of_week <= 6) OR (day_of_week >= 0 AND day_of_week < ?))
                AND is_active = true
                ORDER BY 
                    CASE WHEN day_of_week > ? THEN day_of_week ELSE day_of_week + 7 END,
                    session_number
                LIMIT 1
            `, [dayOfWeek, dayOfWeek, dayOfWeek], callback);
        });
    }

    close() {
        this.db.close();
    }
}

module.exports = Database;
