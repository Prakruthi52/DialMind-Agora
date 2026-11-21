-- Data version 2: standard 8-digit registration numbers for farmer identification.
-- Applied once by lib/db.ts to databases seeded before this change (targeted UPDATEs, so
-- existing sessions, answers and claims are untouched). New databases get this from seed.sql.
UPDATE policies SET registration_no = '41000101' WHERE policy_no = 'PMFBY-KA-26K-000123';
UPDATE policies SET registration_no = '41000202' WHERE policy_no = 'PMFBY-KA-26K-000456';
UPDATE policies SET registration_no = '41000303' WHERE policy_no = 'PMFBY-MP-26K-000789';

UPDATE questions SET
  text_en = 'Please tell me your 8-digit crop insurance registration number. It is printed on your policy slip.',
  text_hi = 'अपना 8 अंकों का फसल बीमा रजिस्ट्रेशन नंबर बताइए। ये आपकी पॉलिसी की पर्ची पर लिखा होता है।',
  text_kn = 'ನಿಮ್ಮ 8 ಅಂಕಿಯ ಬೆಳೆ ವಿಮೆ ನೋಂದಣಿ ಸಂಖ್ಯೆಯನ್ನು ಹೇಳಿ. ಅದು ನಿಮ್ಮ ಪಾಲಿಸಿ ಚೀಟಿಯಲ್ಲಿ ಇರುತ್ತದೆ.',
  hint_en = 'Eight digits, said one by one. It is printed on the policy slip.',
  validation_regex = '^[0-9]{8}$'
WHERE code = 'policy_ref';

UPDATE rules SET
  description = 'No policy matches the registration number',
  message_en = 'I could not find that registration number. Could you check the policy slip and say the 8 digits again slowly?',
  message_hi = 'ये रजिस्ट्रेशन नंबर नहीं मिला। पर्ची देखकर 8 अंक एक बार धीरे-धीरे फिर से बताइए?',
  message_kn = 'ಈ ನೋಂದಣಿ ಸಂಖ್ಯೆ ಸಿಗಲಿಲ್ಲ. ಚೀಟಿ ನೋಡಿ 8 ಅಂಕಿಗಳನ್ನು ನಿಧಾನವಾಗಿ ಮತ್ತೆ ಹೇಳಿ.'
WHERE code = 'R_POLICY_NOT_FOUND';
