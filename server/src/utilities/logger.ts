// server/src/utilities/logger.ts
import { Connection } from 'vscode-languageserver/node';

/**
 * Log levels for the logger
 */
export enum LogLevel {
    NONE = 0,
    ERROR = 1,
    WARN = 2,
    INFO = 3,
    DEBUG = 4,
    TRACE = 5
}

/**
 * Logger class for consistent logging across the server
 */
export class Logger {
    private connection: Connection;
    private level: LogLevel = LogLevel.INFO;
    private enabled: boolean = false;
    private startTime: number = Date.now();
    
    /**
     * Create a new logger
     */
    constructor(connection: Connection) {
        this.connection = connection;
    }
    
    /**
     * Set the logging level
     */
    public setLevel(level: string): void {
        switch (level.toLowerCase()) {
            case 'none':
                this.level = LogLevel.NONE;
                break;
            case 'error':
                this.level = LogLevel.ERROR;
                break;
            case 'warn':
                this.level = LogLevel.WARN;
                break;
            case 'info':
                this.level = LogLevel.INFO;
                break;
            case 'debug':
                this.level = LogLevel.DEBUG;
                break;
            case 'trace':
                this.level = LogLevel.TRACE;
                break;
            default:
                this.level = LogLevel.INFO;
        }
    }
    
    /**
     * Enable or disable logging
     */
    public setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }
    
    /**
     * Log an error message
     */
    public error(message: string): void {
        this.logMessage(LogLevel.ERROR, `[ERROR] ${message}`);
    }
    
    /**
     * Log a warning message
     */
    public warn(message: string): void {
        this.logMessage(LogLevel.WARN, `[WARN] ${message}`);
    }
    
    /**
     * Log an info message
     */
    public log(message: string): void {
        this.logMessage(LogLevel.INFO, `[INFO] ${message}`);
    }
    
    /**
     * Log a debug message
     */
    public debug(message: string): void {
        this.logMessage(LogLevel.DEBUG, `[DEBUG] ${message}`);
    }
    
    /**
     * Log a trace message
     */
    public trace(message: string): void {
        this.logMessage(LogLevel.TRACE, `[TRACE] ${message}`);
    }
    
    /**
     * Log a message with a timestamp
     */
    private logMessage(level: LogLevel, message: string): void {
        if (!this.enabled || level > this.level) {
            return;
        }
        
        const elapsed = Date.now() - this.startTime;
        const timestamp = this.formatTime(elapsed);
        this.connection.console.log(`${timestamp} ${message}`);
    }
    
    /**
     * Format a time in milliseconds as a readable string
     */
    private formatTime(ms: number): string {
        const seconds = Math.floor(ms / 1000);
        const millis = ms % 1000;
        
        if (seconds < 60) {
            return `[${seconds}.${millis.toString().padStart(3, '0')}s]`;
        }
        
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = seconds % 60;
        
        return `[${minutes}m${remainingSeconds}s]`;
    }
    
    /**
     * Create a scoped logger with a prefix
     */
    public createScoped(scope: string): Logger {
        const scopedLogger = new Logger(this.connection);
        scopedLogger.level = this.level;
        scopedLogger.enabled = this.enabled;
        
        // Override log methods to add scope
        const originalError = scopedLogger.error;
        scopedLogger.error = (message: string) => {
            originalError.call(scopedLogger, `[${scope}] ${message}`);
        };
        
        const originalWarn = scopedLogger.warn;
        scopedLogger.warn = (message: string) => {
            originalWarn.call(scopedLogger, `[${scope}] ${message}`);
        };
        
        const originalLog = scopedLogger.log;
        scopedLogger.log = (message: string) => {
            originalLog.call(scopedLogger, `[${scope}] ${message}`);
        };
        
        const originalDebug = scopedLogger.debug;
        scopedLogger.debug = (message: string) => {
            originalDebug.call(scopedLogger, `[${scope}] ${message}`);
        };
        
        const originalTrace = scopedLogger.trace;
        scopedLogger.trace = (message: string) => {
            originalTrace.call(scopedLogger, `[${scope}] ${message}`);
        };
        
        return scopedLogger;
    }
}