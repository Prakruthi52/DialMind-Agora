-- Fasal Bima Saathi: seed data
-- Question flow for PMFBY-style crop-loss intimation, multilingual synonyms,
-- spoken-number / date / land-unit lexicon, rules, and mock policies.
-- Placeholders like {farmer_name} are filled by the server from session context.
-- NOTE: Hindi and Kannada wording should be reviewed by a native speaker.

-- Removed in v2: crop-photo step.
DELETE FROM questions WHERE code = 'evidence_photo';
DELETE FROM rules WHERE code = 'R_NO_EVIDENCE';

-- ───────────────────────── Agent texts ─────────────────────────
-- The agent is "Vanya" from DialMind.
INSERT OR REPLACE INTO agent_texts (key, text_en, text_hi, text_kn) VALUES
('greeting',
 'Hello, I am Vanya from DialMind. I am sorry to hear about your crop damage. I will ask you a few questions to register your crop insurance claim.',
 'नमस्ते, मैं DialMind से वान्या बोल रही हूँ। आपकी फसल के नुकसान के बारे में सुनकर दुख हुआ। आपका फसल बीमा क्लेम दर्ज करने के लिए मैं आपसे कुछ सवाल पूछूँगी।',
 'ನಮಸ್ಕಾರ, ನಾನು DialMind ನಿಂದ ವನ್ಯಾ. ನಿಮ್ಮ ಬೆಳೆ ಹಾನಿಯ ಬಗ್ಗೆ ಕೇಳಿ ಬೇಸರವಾಯಿತು. ನಿಮ್ಮ ಬೆಳೆ ವಿಮೆ ಕ್ಲೈಮ್ ದಾಖಲಿಸಲು ನಾನು ಕೆಲವು ಪ್ರಶ್ನೆಗಳನ್ನು ಕೇಳುತ್ತೇನೆ.'),
('closing_filed',
 'Your claim is registered. Your claim number is {claim_id}. You will get an SMS, and a surveyor will visit by {surveyor_date}. Thank you, and take care.',
 'आपका क्लेम दर्ज हो गया है। आपका क्लेम नंबर है {claim_id}। आपको SMS आएगा, और {surveyor_date} तक सर्वेयर आएँगे। धन्यवाद, अपना ध्यान रखिए।',
 'ನಿಮ್ಮ ಕ್ಲೈಮ್ ದಾಖಲಾಗಿದೆ. ನಿಮ್ಮ ಕ್ಲೈಮ್ ಸಂಖ್ಯೆ {claim_id}. ನಿಮಗೆ SMS ಬರುತ್ತದೆ, {surveyor_date} ಒಳಗೆ ಸರ್ವೇಯರ್ ಬರುತ್ತಾರೆ. ಧನ್ಯವಾದಗಳು, ಹುಷಾರಾಗಿರಿ.'),
('closing_area_based',
 'Your complaint is recorded. You will get an SMS when the area assessment is complete. Thank you for calling DialMind.',
 'आपकी शिकायत दर्ज हो गई है। इलाके का आकलन पूरा होने पर आपको SMS आएगा। DialMind को कॉल करने के लिए धन्यवाद।',
 'ನಿಮ್ಮ ದೂರು ದಾಖಲಾಗಿದೆ. ಪ್ರದೇಶದ ಅಂದಾಜು ಮುಗಿದಾಗ ನಿಮಗೆ SMS ಬರುತ್ತದೆ. DialMind ಗೆ ಕರೆ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.'),
('closing_not_covered',
 'I am sorry this loss is not covered. If you think something is wrong, you can call the crop insurance helpline. Thank you for calling DialMind.',
 'माफ़ कीजिए, ये नुकसान कवर नहीं है। अगर आपको लगता है कुछ गलत है, तो फसल बीमा हेल्पलाइन पर कॉल कर सकते हैं। DialMind को कॉल करने के लिए धन्यवाद।',
 'ಕ್ಷಮಿಸಿ, ಈ ಹಾನಿ ಒಳಗೊಂಡಿಲ್ಲ. ಏನಾದರೂ ತಪ್ಪಾಗಿದೆ ಅನಿಸಿದರೆ, ಬೆಳೆ ವಿಮೆ ಸಹಾಯವಾಣಿಗೆ ಕರೆ ಮಾಡಬಹುದು. DialMind ಗೆ ಕರೆ ಮಾಡಿದ್ದಕ್ಕೆ ಧನ್ಯವಾದಗಳು.');

-- ───────────────────────── Questions ─────────────────────────
INSERT OR REPLACE INTO questions
(code, seq, answer_type, text_en, text_hi, text_kn, hint_en, validation_regex, min_value, max_value, required, ask_if, max_retries) VALUES
('policy_ref', 10, 'policy_ref',
 'Please tell me your registered mobile number or your crop insurance policy number.',
 'अपना रजिस्टर्ड मोबाइल नंबर या फसल बीमा पॉलिसी नंबर बताइए।',
 'ನಿಮ್ಮ ನೋಂದಾಯಿತ ಮೊಬೈಲ್ ಸಂಖ್ಯೆ ಅಥವಾ ಬೆಳೆ ವಿಮೆ ಪಾಲಿಸಿ ಸಂಖ್ಯೆಯನ್ನು ಹೇಳಿ.',
 'A 10-digit mobile number, said digit by digit, is easiest.',
 '^([6-9][0-9]{9}|PMFBY-[A-Z]{2}-[0-9]{2}[KR]-[0-9]{6})$', NULL, NULL, 1, NULL, 3),

('confirm_identity', 20, 'yes_no',
 'I found a policy in the name of {farmer_name} from {village}. Is that you?',
 'मुझे {village} के {farmer_name} के नाम पर पॉलिसी मिली है। क्या ये आप ही हैं?',
 '{village} ನ {farmer_name} ಅವರ ಹೆಸರಿನಲ್ಲಿ ಪಾಲಿಸಿ ಸಿಕ್ಕಿದೆ. ಅದು ನೀವೇನಾ?',
 'Please answer yes or no.', NULL, NULL, NULL, 1, NULL, 2),

('crop_affected', 30, 'enum',
 'Which crop was damaged? Your policy covers {insured_crops}.',
 'किस फसल का नुकसान हुआ है? आपकी पॉलिसी में {insured_crops} शामिल हैं।',
 'ಯಾವ ಬೆಳೆಗೆ ಹಾನಿಯಾಗಿದೆ? ನಿಮ್ಮ ಪಾಲಿಸಿಯಲ್ಲಿ {insured_crops} ಇದೆ.',
 'Name one of the crops on your policy.', NULL, NULL, NULL, 1, NULL, 2),

('cause_of_loss', 40, 'enum',
 'What caused the damage? For example hailstorm, flood, unseasonal rain or wild animals.',
 'नुकसान किस वजह से हुआ? जैसे ओलावृष्टि, बाढ़, बेमौसम बारिश या जंगली जानवर।',
 'ಹಾನಿಗೆ ಕಾರಣ ಏನು? ಉದಾಹರಣೆಗೆ ಆಲಿಕಲ್ಲು ಮಳೆ, ಪ್ರವಾಹ, ಅಕಾಲಿಕ ಮಳೆ ಅಥವಾ ಕಾಡುಪ್ರಾಣಿಗಳು.',
 'Describe what happened in a few words, like "heavy rain" or "elephants".', NULL, NULL, NULL, 1, NULL, 2),

('crop_stage', 50, 'enum',
 'When the damage happened, was the crop still standing in the field, or already harvested and kept for drying?',
 'नुकसान के समय फसल खेत में खड़ी थी, या कटाई करके सूखने के लिए रखी थी?',
 'ಹಾನಿಯಾದಾಗ ಬೆಳೆ ಹೊಲದಲ್ಲಿ ನಿಂತಿತ್ತಾ, ಅಥವಾ ಕಟಾವು ಮಾಡಿ ಒಣಗಲು ಹಾಕಿದ್ದಿರಾ?',
 'Say "standing" or "harvested".', NULL, NULL, NULL, 1,
 '{"op":"not_in","field":"cause_of_loss","values":["drought","pest_disease"]}', 2),

('loss_date', 60, 'date',
 'On which day did the damage happen?',
 'नुकसान किस दिन हुआ?',
 'ಹಾನಿ ಯಾವ ದಿನ ಆಯಿತು?',
 'You can say "yesterday", "two days ago" or a date like 18 November.', NULL, NULL, NULL, 1,
 '{"op":"not_in","field":"cause_of_loss","values":["drought","pest_disease"]}', 2),

('late_reason', 65, 'free_text',
 'It has been more than 72 hours since the damage. What stopped you from reporting it earlier?',
 'नुकसान को 72 घंटे से ज़्यादा हो गए हैं। देर से बताने की वजह क्या है?',
 'ಹಾನಿಯಾಗಿ 72 ಗಂಟೆಗಿಂತ ಹೆಚ್ಚು ಸಮಯವಾಗಿದೆ. ತಡವಾಗಿ ತಿಳಿಸಲು ಕಾರಣ ಏನು?',
 'Any reason is fine, for example the road was flooded or no network.', NULL, NULL, NULL, 1,
 '{"op":"flag_set","rule":"R_LATE_INTIMATION"}', 1),

('harvest_date', 70, 'date',
 'On which day was the crop harvested?',
 'फसल की कटाई किस दिन की थी?',
 'ಬೆಳೆಯನ್ನು ಯಾವ ದಿನ ಕಟಾವು ಮಾಡಿದ್ದೀರಿ?',
 'An approximate day is fine, like "last Monday" or "five days ago".', NULL, NULL, NULL, 1,
 '{"op":"eq","field":"crop_stage","value":"harvested_drying"}', 2),

('affected_area', 80, 'area',
 'On how much land was the crop damaged? You can say acres or guntas. Your {crop} plot is {insured_area} acres.',
 'कितनी ज़मीन पर फसल का नुकसान हुआ? एकड़ या गुंठा में बताइए। आपका {crop} का खेत {insured_area} एकड़ का है।',
 'ಎಷ್ಟು ಜಮೀನಿನಲ್ಲಿ ಬೆಳೆ ಹಾನಿಯಾಗಿದೆ? ಎಕರೆ ಅಥವಾ ಗುಂಟೆಯಲ್ಲಿ ಹೇಳಿ. ನಿಮ್ಮ {crop} ಹೊಲ {insured_area} ಎಕರೆ ಇದೆ.',
 'For example "two acres" or "dhai acre" or "thirty guntas".', NULL, 0.01, 100, 1,
 '{"op":"not_in","field":"cause_of_loss","values":["drought","pest_disease"]}', 2),

('loss_percent', 90, 'percent',
 'Roughly what percentage of the crop on that land is ruined?',
 'उस ज़मीन पर लगभग कितने प्रतिशत फसल खराब हुई है?',
 'ಆ ಜಮೀನಿನಲ್ಲಿ ಸುಮಾರು ಎಷ್ಟು ಪ್ರತಿಶತ ಬೆಳೆ ಹಾಳಾಗಿದೆ?',
 'A rough number is fine, like "half" or "seventy percent".', NULL, 1, 100, 1,
 '{"op":"not_in","field":"cause_of_loss","values":["drought","pest_disease"]}', 2),

('confirm_sms', 110, 'yes_no',
 'Shall I send claim updates by SMS to your number ending in {mobile_last4}?',
 'क्या क्लेम की जानकारी SMS से {mobile_last4} पर ख़त्म होने वाले नंबर पर भेज दूँ?',
 'ಕ್ಲೈಮ್ ಮಾಹಿತಿಯನ್ನು {mobile_last4} ರಲ್ಲಿ ಕೊನೆಗೊಳ್ಳುವ ನಂಬರ್‌ಗೆ SMS ಮೂಲಕ ಕಳುಹಿಸಲೇ?',
 'Please answer yes or no.', NULL, NULL, NULL, 1,
 '{"op":"not_in","field":"cause_of_loss","values":["drought","pest_disease"]}', 2),

('final_confirmation', 120, 'yes_no',
 'Here is your claim: {summary}. Shall I register this claim now?',
 'आपका क्लेम: {summary}। क्या मैं ये क्लेम अभी दर्ज कर दूँ?',
 'ನಿಮ್ಮ ಕ್ಲೈಮ್: {summary}. ಈಗ ಈ ಕ್ಲೈಮ್ ದಾಖಲಿಸಲೇ?',
 'Say yes to register, or tell me what to correct.', NULL, NULL, NULL, 1,
 '{"op":"not_in","field":"cause_of_loss","values":["drought","pest_disease"]}', 2);

-- ───────────────────────── Options + synonyms ─────────────────────────
INSERT OR REPLACE INTO question_options (question_code, value, label_en, label_hi, label_kn, synonyms, meta) VALUES
-- crops
('crop_affected','paddy','paddy','धान','ಭತ್ತ','paddy|rice|dhaan|dhan|chawal|bhatta|bhatha|ಭತ್ತ|धान|चावल',NULL),
('crop_affected','ragi','ragi','रागी','ರಾಗಿ','ragi|finger millet|nachni|mandua|ರಾಗಿ|रागी|मडुआ',NULL),
('crop_affected','maize','maize','मक्का','ಮೆಕ್ಕೆಜೋಳ','maize|corn|makka|makai|bhutta|mekke jola|musukina jola|ಮೆಕ್ಕೆಜೋಳ|मक्का',NULL),
('crop_affected','tur','tur dal','अरहर','ತೊಗರಿ','tur|toor|arhar|red gram|pigeon pea|togari|ತೊಗರಿ|अरहर|तुअर',NULL),
('crop_affected','cotton','cotton','कपास','ಹತ್ತಿ','cotton|kapas|narma|hatti|ಹತ್ತಿ|कपास',NULL),
('crop_affected','groundnut','groundnut','मूंगफली','ಶೇಂಗಾ','groundnut|peanut|moongphali|mungfali|shenga|kadalekai|ನೆಲಗಡಲೆ|ಶೇಂಗಾ|मूंगफली',NULL),
('crop_affected','jowar','jowar','ज्वार','ಜೋಳ','jowar|sorghum|jola|bili jola|ಜೋಳ|ज्वार',NULL),
('crop_affected','soybean','soybean','सोयाबीन','ಸೋಯಾಬೀನ್','soybean|soyabean|soya|ಸೋಯಾ|सोयाबीन',NULL),
-- causes (meta.claim_path drives branching)
('cause_of_loss','hailstorm','hailstorm','ओलावृष्टि','ಆಲಿಕಲ್ಲು ಮಳೆ','hailstorm|hail|ole|ola|ole pade|olavrishti|alikallu|alikallu male|ಆಲಿಕಲ್ಲು|ओले|ओलावृष्टि','{"claim_path":"individual"}'),
('cause_of_loss','inundation','flood or waterlogging','बाढ़ / जलभराव','ಪ್ರವಾಹ / ನೀರು ನಿಂತಿದೆ','flood|flooding|inundation|waterlogging|water logging|baadh|badh|paani bhar gaya|pani bhar gaya|neeru nintide|nere|pravaha|ಪ್ರವಾಹ|ನೆರೆ|बाढ़|जलभराव','{"claim_path":"individual"}'),
('cause_of_loss','landslide','landslide','भूस्खलन','ಭೂಕುಸಿತ','landslide|bhuskhalan|gudda kusita|bhukusita|ಭೂಕುಸಿತ|भूस्खलन','{"claim_path":"individual"}'),
('cause_of_loss','cloudburst','cloudburst','बादल फटना','ಮೇಘಸ್ಫೋಟ','cloudburst|cloud burst|badal phatna|badal fat gaya|meghasphota|ಮೇಘಸ್ಫೋಟ|बादल फटना','{"claim_path":"individual"}'),
('cause_of_loss','natural_fire','fire from lightning','आग','ಬೆಂಕಿ','fire|aag|aag lag gayi|lightning|bijli gir|sidilu|benki|ಬೆಂಕಿ|ಸಿಡಿಲು|आग|बिजली','{"claim_path":"individual"}'),
('cause_of_loss','unseasonal_rain','unseasonal rain','बेमौसम बारिश','ಅಕಾಲಿಕ ಮಳೆ','unseasonal rain|untimely rain|heavy rain|bemausam barish|bemausam baarish|tez barish|bahut barish|akaalika male|akala male|jasti male|bhari male|ಅಕಾಲಿಕ ಮಳೆ|ಭಾರಿ ಮಳೆ|बेमौसम बारिश|तेज़ बारिश','{"claim_path":"by_stage"}'),
('cause_of_loss','cyclone','cyclone','चक्रवात / तूफ़ान','ಚಂಡಮಾರುತ','cyclone|storm|toofan|tufan|aandhi|chakravaat|chandamaruta|birugali|ಚಂಡಮಾರುತ|ಬಿರುಗಾಳಿ|तूफ़ान|चक्रवात|आंधी','{"claim_path":"by_stage"}'),
('cause_of_loss','drought','drought or dry spell','सूखा','ಬರ','drought|dry spell|sukha|sookha|barish nahi hui|bara|male illa|male banilla|ಬರ|ಮಳೆ ಇಲ್ಲ|सूखा','{"claim_path":"area_based"}'),
('cause_of_loss','pest_disease','pests or disease','कीट / रोग','ಕೀಟ / ರೋಗ','pest|pests|insects|keede|keeda|kida|rog|bimari|disease|keeta|roga|hula|ಕೀಟ|ರೋಗ|ಹುಳ|कीड़े|रोग','{"claim_path":"area_based"}'),
('cause_of_loss','wild_animal','wild animal attack','जंगली जानवर','ಕಾಡುಪ್ರಾಣಿ ದಾಳಿ','wild animal|wild animals|elephant|elephants|wild boar|jungli janwar|jangli janwar|haathi|hathi|suar|neelgai|aane|kaadu handi|ಆನೆ|ಕಾಡುಹಂದಿ|ಕಾಡುಪ್ರಾಣಿ|जंगली जानवर|हाथी|नीलगाय','{"claim_path":"individual","add_on":true}'),
-- crop stage
('crop_stage','standing','standing in the field','खेत में खड़ी','ಹೊಲದಲ್ಲಿ ನಿಂತಿತ್ತು','standing|in the field|khadi|khadi thi|khet mein|khet me|field mein|nintittu|holadalli|ಹೊಲದಲ್ಲಿ|ನಿಂತಿತ್ತು|खड़ी|खेत में',NULL),
('crop_stage','harvested_drying','harvested and drying','कटाई के बाद सूख रही थी','ಕಟಾವು ಮಾಡಿ ಒಣಗಲು ಹಾಕಿತ್ತು','harvested|cut|kat gayi|kaat li|katai|katai ho gayi|sookhne|sukhane|drying|kataavu|kataavu aagittu|onagalu|ಕಟಾವು|ಒಣಗಲು|कटाई|सूखने|काट ली',NULL);

-- ───────────────────────── Lexicon ─────────────────────────
INSERT OR REPLACE INTO lexicon (term, kind, value, lang) VALUES
-- Hindi / Hinglish numbers
('ek','number',1,'hi'),('do','number',2,'hi'),('teen','number',3,'hi'),('char','number',4,'hi'),('chaar','number',4,'hi'),
('paanch','number',5,'hi'),('panch','number',5,'hi'),('chhe','number',6,'hi'),('chah','number',6,'hi'),('saat','number',7,'hi'),
('aath','number',8,'hi'),('nau','number',9,'hi'),('das','number',10,'hi'),('bees','number',20,'hi'),('tees','number',30,'hi'),
('chalis','number',40,'hi'),('pachas','number',50,'hi'),('pachaas','number',50,'hi'),('sau','number',100,'hi'),
('aadha','number',0.5,'hi'),('dedh','number',1.5,'hi'),('dhai','number',2.5,'hi'),('dhaai','number',2.5,'hi'),('pauna','number',0.75,'hi'),
-- Kannada numbers
('ondu','number',1,'kn'),('eradu','number',2,'kn'),('mooru','number',3,'kn'),('naalku','number',4,'kn'),('aidu','number',5,'kn'),
('aaru','number',6,'kn'),('elu','number',7,'kn'),('entu','number',8,'kn'),('ombattu','number',9,'kn'),('hattu','number',10,'kn'),
('ippattu','number',20,'kn'),('muvattu','number',30,'kn'),('nalavattu','number',40,'kn'),('aivattu','number',50,'kn'),('nooru','number',100,'kn'),
('ardha','number',0.5,'kn'),('ಒಂದು','number',1,'kn'),('ಎರಡು','number',2,'kn'),('ಮೂರು','number',3,'kn'),('ಅರ್ಧ','number',0.5,'kn'),
-- relative days (past context: loss / harvest happened already)
('aaj','day_offset',0,'hi'),('today','day_offset',0,'en'),('ivattu','day_offset',0,'kn'),('ಇವತ್ತು','day_offset',0,'kn'),
('kal','day_offset',-1,'hi'),('kal raat','day_offset',-1,'hi'),('yesterday','day_offset',-1,'en'),('ninne','day_offset',-1,'kn'),('ನಿನ್ನೆ','day_offset',-1,'kn'),
('parso','day_offset',-2,'hi'),('day before yesterday','day_offset',-2,'en'),('monne','day_offset',-2,'kn'),('ಮೊನ್ನೆ','day_offset',-2,'kn'),
('narso','day_offset',-3,'hi'),
-- land units (acres per unit). Bigha varies by state: value is a Madhya Pradesh approximation and is flagged.
('acre','area_unit',1,'en'),('acres','area_unit',1,'en'),('ekad','area_unit',1,'hi'),('ekar','area_unit',1,'hi'),('ekre','area_unit',1,'kn'),('ಎಕರೆ','area_unit',1,'kn'),('एकड़','area_unit',1,'hi'),
('hectare','area_unit',2.471,'en'),('hectares','area_unit',2.471,'en'),('hektare','area_unit',2.471,'hi'),
('gunta','area_unit',0.025,'kn'),('guntha','area_unit',0.025,'mixed'),('gunte','area_unit',0.025,'kn'),('ಗುಂಟೆ','area_unit',0.025,'kn'),('गुंठा','area_unit',0.025,'hi'),
('cent','area_unit',0.01,'mixed'),('cents','area_unit',0.01,'mixed'),
('bigha','area_unit',0.62,'hi'),
-- percent words
('half','percent',50,'en'),('aadha','percent',50,'hi'),('ardha','percent',50,'kn'),('ಅರ್ಧ','percent',50,'kn'),
('full','percent',100,'en'),('poora','percent',100,'hi'),('pura','percent',100,'hi'),('sab','percent',100,'hi'),('sara','percent',100,'hi'),
('ella','percent',100,'kn'),('poorti','percent',100,'kn'),('ಎಲ್ಲಾ','percent',100,'kn'),
('quarter','percent',25,'en'),('chauthai','percent',25,'hi'),('teen chauthai','percent',75,'hi'),
-- yes / no
('yes','yes',1,'en'),('yeah','yes',1,'en'),('correct','yes',1,'en'),('right','yes',1,'en'),('haan','yes',1,'hi'),('ha','yes',1,'hi'),('haa','yes',1,'hi'),
('haan ji','yes',1,'hi'),('ji','yes',1,'hi'),('ji haan','yes',1,'hi'),('sahi','yes',1,'hi'),('theek','yes',1,'hi'),('theek hai','yes',1,'hi'),('bilkul','yes',1,'hi'),
('howdu','yes',1,'kn'),('haudu','yes',1,'kn'),('sari','yes',1,'kn'),('aagli','yes',1,'kn'),('ಹೌದು','yes',1,'kn'),('हाँ','yes',1,'hi'),('हां','yes',1,'hi'),
('no','no',0,'en'),('nope','no',0,'en'),('wrong','no',0,'en'),('nahi','no',0,'hi'),('nahin','no',0,'hi'),('na','no',0,'hi'),('galat','no',0,'hi'),
('illa','no',0,'kn'),('beda','no',0,'kn'),('alla','no',0,'kn'),('ಇಲ್ಲ','no',0,'kn'),('ಬೇಡ','no',0,'kn'),('नहीं','no',0,'hi'),('ना','no',0,'hi');

-- ───────────────────────── Rules ─────────────────────────
-- condition DSL (see docs/DESIGN.md §5): eq, in, not_in, gt, lt, days_since_gt, days_between_gt,
-- policy_found, crop_on_policy, area_exceeds_insured, before_sowing.
INSERT OR REPLACE INTO rules (code, question_code, description, rule_type, condition, message_en, message_hi, message_kn) VALUES
('R_POLICY_NOT_FOUND','policy_ref','No policy matches the mobile or policy number','reject',
 '{"op":"policy_found","negate":true}',
 'I could not find a policy with that number. Could you say it again slowly?',
 'इस नंबर से कोई पॉलिसी नहीं मिली। क्या आप धीरे-धीरे दोबारा बता सकते हैं?',
 'ಆ ಸಂಖ್ಯೆಯಲ್ಲಿ ಪಾಲಿಸಿ ಸಿಗಲಿಲ್ಲ. ದಯವಿಟ್ಟು ನಿಧಾನವಾಗಿ ಮತ್ತೆ ಹೇಳಿ.'),

('R_IDENTITY_DENIED','confirm_identity','Caller says the policy is not theirs','branch',
 '{"op":"eq","field":"confirm_identity","value":"no","goto":"policy_ref"}',
 'No problem, let us try another number.',
 'कोई बात नहीं, दूसरा नंबर बताइए।',
 'ಪರವಾಗಿಲ್ಲ, ಬೇರೆ ಸಂಖ್ಯೆ ಹೇಳಿ.'),

('R_CROP_NOT_INSURED','crop_affected','Crop is not on this policy','reject',
 '{"op":"crop_on_policy","negate":true}',
 'That crop is not on your policy. Your policy covers {insured_crops}.',
 'ये फसल आपकी पॉलिसी में नहीं है। आपकी पॉलिसी में {insured_crops} शामिल हैं।',
 'ಆ ಬೆಳೆ ನಿಮ್ಮ ಪಾಲಿಸಿಯಲ್ಲಿ ಇಲ್ಲ. ನಿಮ್ಮ ಪಾಲಿಸಿಯಲ್ಲಿ {insured_crops} ಇದೆ.'),

('R_AREA_BASED_CAUSE','cause_of_loss','Drought and widespread pests are settled per area through crop-cutting experiments, not individual claims','branch',
 '{"op":"in","field":"cause_of_loss","values":["drought","pest_disease"],"goto":"END_AREA_BASED"}',
 'For drought and pest attacks, the government assesses the whole area through crop-cutting experiments, so you do not need an individual claim. I have recorded your complaint and you will get an SMS when the area assessment is done.',
 'सूखा और कीट के नुकसान का आकलन पूरे इलाके के लिए फसल कटाई प्रयोग से होता है, इसलिए अलग से क्लेम की ज़रूरत नहीं है। मैंने आपकी शिकायत दर्ज कर ली है, आकलन होने पर SMS आएगा।',
 'ಬರ ಮತ್ತು ಕೀಟ ಹಾನಿಯನ್ನು ಇಡೀ ಪ್ರದೇಶಕ್ಕೆ ಬೆಳೆ ಕಟಾವು ಪ್ರಯೋಗದ ಮೂಲಕ ಅಂದಾಜಿಸಲಾಗುತ್ತದೆ, ಪ್ರತ್ಯೇಕ ಕ್ಲೈಮ್ ಬೇಕಿಲ್ಲ. ನಿಮ್ಮ ದೂರು ದಾಖಲಿಸಿದ್ದೇನೆ, ಅಂದಾಜು ಆದಾಗ SMS ಬರುತ್ತದೆ.'),

('R_WILD_ANIMAL_ADDON','cause_of_loss','Wild animal damage is an add-on cover that only some states offer','flag',
 '{"op":"eq","field":"cause_of_loss","value":"wild_animal"}',
 'Wild animal damage is covered only where the state has opted for this add-on. I will register it and the insurer will confirm.',
 'जंगली जानवरों का नुकसान तभी कवर होता है जब राज्य ने ये ऐड-ऑन चुना हो। मैं दर्ज कर देती हूँ, बीमा कंपनी पुष्टि करेगी।',
 'ಕಾಡುಪ್ರಾಣಿ ಹಾನಿ ರಾಜ್ಯ ಈ ಹೆಚ್ಚುವರಿ ವಿಮೆ ಆಯ್ಕೆ ಮಾಡಿದ್ದರೆ ಮಾತ್ರ ಸಿಗುತ್ತದೆ. ದಾಖಲಿಸುತ್ತೇನೆ, ವಿಮಾ ಕಂಪನಿ ಖಚಿತಪಡಿಸುತ್ತದೆ.'),

('R_FUTURE_DATE','loss_date','Loss date cannot be in the future','reject',
 '{"op":"days_since_gt","field":"loss_date","value":0,"negate":true,"strict":"future"}',
 'That date is in the future. On which day did the damage actually happen?',
 'ये तारीख़ आगे की है। नुकसान असल में किस दिन हुआ?',
 'ಆ ದಿನಾಂಕ ಮುಂದಿನದು. ಹಾನಿ ನಿಜವಾಗಿ ಯಾವ ದಿನ ಆಯಿತು?'),

('R_BEFORE_SOWING','loss_date','Loss date is before the crop was sown','reject',
 '{"op":"before_sowing","field":"loss_date"}',
 'That date is before your crop was sown on {sowing_date}. Please check the day.',
 'ये तारीख़ बुवाई ({sowing_date}) से पहले की है। कृपया दिन दोबारा बताइए।',
 'ಆ ದಿನಾಂಕ ಬಿತ್ತನೆ ({sowing_date}) ಗಿಂತ ಮೊದಲು. ದಯವಿಟ್ಟು ದಿನ ಮತ್ತೆ ಹೇಳಿ.'),

('R_LATE_INTIMATION','loss_date','PMFBY expects localised losses to be reported within 72 hours','warn',
 '{"op":"days_since_gt","field":"loss_date","value":3}',
 'Losses should be reported within 72 hours. I will still register it, but the insurer may ask why it was late.',
 'नुकसान 72 घंटे के अंदर बताना होता है। मैं फिर भी दर्ज कर दूँगी, पर बीमा कंपनी देरी की वजह पूछ सकती है।',
 'ಹಾನಿಯನ್ನು 72 ಗಂಟೆಯೊಳಗೆ ತಿಳಿಸಬೇಕು. ಆದರೂ ದಾಖಲಿಸುತ್ತೇನೆ, ವಿಮಾ ಕಂಪನಿ ತಡಕ್ಕೆ ಕಾರಣ ಕೇಳಬಹುದು.'),

('R_POST_HARVEST_WINDOW','harvest_date','Post-harvest losses are covered only up to 14 days after harvest','branch',
 '{"op":"days_between_gt","from":"harvest_date","to":"loss_date","value":14,"goto":"END_NOT_COVERED"}',
 'Post-harvest damage is covered only within 14 days of harvesting, so this loss is not covered. I am sorry.',
 'कटाई के बाद का नुकसान सिर्फ़ 14 दिन तक कवर होता है, इसलिए ये नुकसान कवर नहीं है। माफ़ कीजिए।',
 'ಕಟಾವು ನಂತರದ ಹಾನಿ 14 ದಿನಗಳವರೆಗೆ ಮಾತ್ರ ಸಿಗುತ್ತದೆ, ಆದ್ದರಿಂದ ಈ ಹಾನಿ ಒಳಗೊಂಡಿಲ್ಲ. ಕ್ಷಮಿಸಿ.'),

('R_AREA_EXCEEDS','affected_area','Damaged area larger than the insured plot','reject',
 '{"op":"area_exceeds_insured","field":"affected_area"}',
 'That is more than your insured {crop} plot of {insured_area} acres. How much of that plot was damaged?',
 'ये आपके {insured_area} एकड़ के बीमित {crop} खेत से ज़्यादा है। उस खेत में कितना नुकसान हुआ?',
 'ಅದು ನಿಮ್ಮ {insured_area} ಎಕರೆ ವಿಮೆ ಮಾಡಿದ {crop} ಹೊಲಕ್ಕಿಂತ ಹೆಚ್ಚು. ಆ ಹೊಲದಲ್ಲಿ ಎಷ್ಟು ಹಾನಿಯಾಗಿದೆ?'),

('R_HIGH_LOSS_PRIORITY','loss_percent','Severe loss gets a priority surveyor visit','flag',
 '{"op":"gt","field":"loss_percent","value":74}',
 'This is a severe loss, so I am marking it for a priority surveyor visit.',
 'नुकसान बहुत ज़्यादा है, इसलिए मैं सर्वेयर की जल्दी विज़िट के लिए मार्क कर रही हूँ।',
 'ಹಾನಿ ತುಂಬಾ ಹೆಚ್ಚು, ಆದ್ದರಿಂದ ಸರ್ವೇಯರ್ ಬೇಗ ಭೇಟಿಗೆ ಗುರುತು ಮಾಡುತ್ತಿದ್ದೇನೆ.');



-- ───────────────────────── Mock policies (demo data, not real people) ─────────────────────────
INSERT OR REPLACE INTO policies (policy_no, farmer_name, mobile, aadhaar_last4, village, district, state, season, insurer, bank_account_last4, preferred_lang) VALUES
('PMFBY-KA-26K-000123','Ramesh Gowda','9000000101','4321','Hosahalli','Mandya','Karnataka','kharif-2026','Demo Krishi Insurance','7781','kn'),
('PMFBY-KA-26K-000456','Lakshmamma','9000000202','8890','Kurudumale','Kolar','Karnataka','kharif-2026','Demo Krishi Insurance','1204','kn'),
('PMFBY-MP-26K-000789','Suresh Patel','9000000303','5567','Ichhawar','Sehore','Madhya Pradesh','kharif-2026','Demo Krishi Insurance','3398','hi');

INSERT OR REPLACE INTO insured_crops (policy_no, crop, survey_no, insured_area_acres, sum_insured_inr, sowing_date) VALUES
('PMFBY-KA-26K-000123','paddy','112/3',2.5,95000,'2026-07-10'),
('PMFBY-KA-26K-000123','ragi','112/4',1.0,30000,'2026-07-25'),
('PMFBY-KA-26K-000456','tur','45/1',3.0,60000,'2026-06-20'),
('PMFBY-KA-26K-000456','groundnut','45/2',2.0,50000,'2026-06-28'),
('PMFBY-MP-26K-000789','soybean','221',4.0,120000,'2026-06-25'),
('PMFBY-MP-26K-000789','maize','222',2.0,55000,'2026-07-02');
