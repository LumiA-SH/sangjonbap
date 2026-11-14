ALTER TABLE public.item
    ADD CONSTRAINT item_battle_special_effect_config_check
        CHECK (
            effect_type IS NULL
                OR effect_type = 'BLOOD_PACK'
                OR (
                effect_type IN ('FIXED_DAMAGE', 'STUN', 'POISON', 'SMOKE')
                    AND category = 'CONSUMABLE'
                    AND usable = true
                    AND battle_usable = true
                    AND blood_pack_kind IS NULL
                    AND effect_value BETWEEN 1 AND 2147483647
                    AND (
                    (effect_type = 'FIXED_DAMAGE' AND use_target = 'OTHER')
                        OR (effect_type = 'STUN' AND use_target = 'OTHER' AND effect_value IN (1, 2))
                        OR (effect_type = 'POISON' AND use_target = 'OTHER' AND effect_value = 10)
                        OR (effect_type = 'SMOKE' AND use_target = 'SELF' AND effect_value <= 100)
                    )
                )
            );