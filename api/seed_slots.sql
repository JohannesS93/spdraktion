-- Falls Gruppen noch nicht da sind
INSERT INTO groups (id, name)
VALUES
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'A'),
('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'B'),
('cccccccc-cccc-cccc-cccc-cccccccccccc', 'C')
ON CONFLICT DO NOTHING;

-- Einige kommende Slots
INSERT INTO duty_slots (
    id,
    slot_date,
    weekday,
    slot_code,
    start_time,
    end_time,
    open_end,
    base_group_id
)
VALUES
-- Heute
('10000000-0000-0000-0000-000000000001', CURRENT_DATE, 'Heute', 'S01', '09:00', '10:00', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('10000000-0000-0000-0000-000000000002', CURRENT_DATE, 'Heute', 'S02', '10:00', '11:00', false, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
('10000000-0000-0000-0000-000000000003', CURRENT_DATE, 'Heute', 'S03', '11:00', '12:00', false, 'cccccccc-cccc-cccc-cccc-cccccccccccc'),

-- Morgen
('10000000-0000-0000-0000-000000000004', CURRENT_DATE + INTERVAL '1 day', 'Morgen', 'S01', '09:00', '10:00', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('10000000-0000-0000-0000-000000000005', CURRENT_DATE + INTERVAL '1 day', 'Morgen', 'S02', '10:00', '11:00', false, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
('10000000-0000-0000-0000-000000000006', CURRENT_DATE + INTERVAL '1 day', 'Morgen', 'S03', '11:00', '12:00', false, 'cccccccc-cccc-cccc-cccc-cccccccccccc'),

-- Übermorgen
('10000000-0000-0000-0000-000000000007', CURRENT_DATE + INTERVAL '2 day', 'Übermorgen', 'S01', '09:00', '10:00', false, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'),
('10000000-0000-0000-0000-000000000008', CURRENT_DATE + INTERVAL '2 day', 'Morgen+2', 'S02', '10:00', '11:00', false, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'),
('10000000-0000-0000-0000-000000000009', CURRENT_DATE + INTERVAL '2 day', 'Morgen+2', 'S03', '11:00', '12:00', false, 'cccccccc-cccc-cccc-cccc-cccccccccccc')
ON CONFLICT DO NOTHING;

-- Alle User aus Gruppe A auf A-Slots
INSERT INTO slot_assignments (id, slot_id, user_id)
SELECT gen_random_uuid(), s.id, u.id
FROM duty_slots s
JOIN users u ON u.group_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
WHERE s.base_group_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
ON CONFLICT DO NOTHING;

-- Alle User aus Gruppe B auf B-Slots
INSERT INTO slot_assignments (id, slot_id, user_id)
SELECT gen_random_uuid(), s.id, u.id
FROM duty_slots s
JOIN users u ON u.group_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
WHERE s.base_group_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
ON CONFLICT DO NOTHING;

-- Alle User aus Gruppe C auf C-Slots
INSERT INTO slot_assignments (id, slot_id, user_id)
SELECT gen_random_uuid(), s.id, u.id
FROM duty_slots s
JOIN users u ON u.group_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
WHERE s.base_group_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc'
ON CONFLICT DO NOTHING;
