use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

const MAX_FAILURES: u32 = 5;
const LOCKOUT_SECONDS: u64 = 30;

#[derive(Debug)]
struct AttemptState {
    failures: u32,
    locked_until: Option<Instant>,
}

#[derive(Debug)]
pub enum PairingFailure {
    Invalid,
    Locked(u64),
    Internal(String),
}

pub struct PairingGate {
    code: Mutex<String>,
    attempts: Mutex<AttemptState>,
}

fn generate_code() -> String {
    let bytes = Uuid::new_v4().into_bytes();
    let value = u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]) % 1_000_000;
    format!("{value:06}")
}

fn constant_time_eq(left: &str, right: &str) -> bool {
    let a = left.as_bytes();
    let b = right.as_bytes();
    if a.len() != b.len() {
        return false;
    }

    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

impl PairingGate {
    pub fn new() -> Self {
        Self {
            code: Mutex::new(generate_code()),
            attempts: Mutex::new(AttemptState {
                failures: 0,
                locked_until: None,
            }),
        }
    }

    pub fn current_code(&self) -> Result<String, String> {
        self.code
            .lock()
            .map(|code| code.clone())
            .map_err(|_| "Pairing code lock failed".to_string())
    }

    pub fn rotate(&self) -> Result<String, String> {
        let next = generate_code();
        {
            let mut code = self
                .code
                .lock()
                .map_err(|_| "Pairing code lock failed".to_string())?;
            *code = next.clone();
        }
        {
            let mut attempts = self
                .attempts
                .lock()
                .map_err(|_| "Pairing state lock failed".to_string())?;
            attempts.failures = 0;
            attempts.locked_until = None;
        }
        Ok(next)
    }

    pub fn verify(&self, supplied: &str) -> Result<(), PairingFailure> {
        let clean = supplied.trim();
        if clean.len() != 6 || !clean.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(PairingFailure::Invalid);
        }

        let now = Instant::now();
        let mut attempts = self
            .attempts
            .lock()
            .map_err(|_| PairingFailure::Internal("Pairing state lock failed".into()))?;

        if let Some(until) = attempts.locked_until {
            if until > now {
                let remaining = until.saturating_duration_since(now).as_secs().max(1);
                return Err(PairingFailure::Locked(remaining));
            }
            attempts.locked_until = None;
            attempts.failures = 0;
        }

        let expected = self
            .code
            .lock()
            .map_err(|_| PairingFailure::Internal("Pairing code lock failed".into()))?
            .clone();

        if constant_time_eq(clean, &expected) {
            attempts.failures = 0;
            attempts.locked_until = None;
            return Ok(());
        }

        attempts.failures += 1;
        if attempts.failures >= MAX_FAILURES {
            attempts.failures = 0;
            attempts.locked_until = Some(now + Duration::from_secs(LOCKOUT_SECONDS));
        }

        Err(PairingFailure::Invalid)
    }
}
