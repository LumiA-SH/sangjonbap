import {lockCharacterByUser, changeInventoryQuantity, writeActionLog} from '../../shared/game.js';

function isDuplicateRequest(err) {
    return err?.code === '23505' && err?.constraint === 'action_log_request_key_key';
}

async function lockItem(client, itemId) {
    const r = await client.query(
        `select id,name,category,transferable,is_active
     from public.item
     where id=$1 and is_active
     for update`,
        [itemId]
    );
    return r.rows[0] || null;
}

async function changeStorageQuantity(client, itemId, delta) {
    const current = await client.query(
        `select item_id,quantity
     from public.storage
     where item_id=$1
     for update`,
        [itemId]
    );

    const before = current.rowCount ? Number(current.rows[0].quantity) : 0;
    const after = before + delta;

    if (after < 0) return {ok:false, before, after};

    if (current.rowCount) {
        await client.query(
            `update public.storage
       set quantity=$1
       where item_id=$2`,
            [after, itemId]
        );
    } else if (after > 0) {
        await client.query(
            `insert into public.storage (item_id,quantity)
       values ($1,$2)`,
            [itemId, after]
        );
    }

    return {ok:true, before, after};
}

export function createInventoryRepository(pool) {
    return {
        async getInventory(userId) {
            const r = await pool.query(
                `select i.item_id,i.quantity,
                m.name,m.category,m.description,m.image_url,
                m.usable,m.use_target,m.effect_type,m.effect_value,m.transferable
         from public.inventory i
         join public.item m on m.id=i.item_id
         join public.auth_user u on u.character_id=i.character_id
         join public.game_character c on c.id=i.character_id
         where u.id=$1 and u.is_active and c.is_active and m.is_active and i.quantity>0
         order by m.category,m.name,m.id`,
                [userId]
            );
            return r.rows;
        },

        async getStorage() {
            const r = await pool.query(
                `select s.item_id,s.quantity,
                m.name,m.category,m.description,m.image_url,
                m.usable,m.use_target,m.effect_type,m.effect_value,m.transferable
         from public.storage s
         join public.item m on m.id=s.item_id
         where m.is_active and s.quantity>0
         order by m.category,m.name,m.id`
            );
            return r.rows;
        },

        async deposit(userId, itemId, quantity, requestKey) {
            const client = await pool.connect();

            try {
                await client.query('begin');

                const character = await lockCharacterByUser(client, userId);
                if (!character) {
                    await client.query('rollback');
                    return {type:'CHARACTER_NOT_FOUND'};
                }

                const item = await lockItem(client, itemId);
                if (!item) {
                    await client.query('rollback');
                    return {type:'ITEM_NOT_FOUND'};
                }

                if (!item.transferable) {
                    await client.query('rollback');
                    return {type:'NOT_TRANSFERABLE'};
                }

                const inventory = await changeInventoryQuantity(client, character.id, itemId, -quantity);
                if (!inventory.ok) {
                    await client.query('rollback');
                    return {type:'NOT_ENOUGH_INVENTORY'};
                }

                const storage = await changeStorageQuantity(client, itemId, quantity);

                await writeActionLog(client, {
                    characterId: character.id,
                    category: 'INVENTORY',
                    targetType: 'ITEM',
                    targetId: itemId,
                    actionType: 'STORAGE_DEPOSIT',
                    description: `${item.name} ${quantity}개를 공용창고에 보관했습니다.`,
                    detail: {
                        item_id: itemId,
                        item_name: item.name,
                        quantity,
                        inventory_before: inventory.before,
                        inventory_after: inventory.after,
                        storage_before: storage.before,
                        storage_after: storage.after
                    },
                    requestKey
                });

                await client.query('commit');

                return {
                    type:'OK',
                    item,
                    quantity,
                    inventoryQuantity:inventory.after,
                    storageQuantity:storage.after
                };
            } catch (err) {
                await client.query('rollback');
                if (isDuplicateRequest(err)) return {type:'DUPLICATE_REQUEST'};
                throw err;
            } finally {
                client.release();
            }
        },

        async withdraw(userId, itemId, quantity, requestKey) {
            const client = await pool.connect();

            try {
                await client.query('begin');

                const character = await lockCharacterByUser(client, userId);
                if (!character) {
                    await client.query('rollback');
                    return {type:'CHARACTER_NOT_FOUND'};
                }

                const item = await lockItem(client, itemId);
                if (!item) {
                    await client.query('rollback');
                    return {type:'ITEM_NOT_FOUND'};
                }

                if (!item.transferable) {
                    await client.query('rollback');
                    return {type:'NOT_TRANSFERABLE'};
                }

                const storage = await changeStorageQuantity(client, itemId, -quantity);
                if (!storage.ok) {
                    await client.query('rollback');
                    return {type:'NOT_ENOUGH_STORAGE'};
                }

                const inventory = await changeInventoryQuantity(client, character.id, itemId, quantity);

                await writeActionLog(client, {
                    characterId: character.id,
                    category: 'INVENTORY',
                    targetType: 'ITEM',
                    targetId: itemId,
                    actionType: 'STORAGE_WITHDRAW',
                    description: `${item.name} ${quantity}개를 공용창고에서 가져왔습니다.`,
                    detail: {
                        item_id: itemId,
                        item_name: item.name,
                        quantity,
                        inventory_before: inventory.before,
                        inventory_after: inventory.after,
                        storage_before: storage.before,
                        storage_after: storage.after
                    },
                    requestKey
                });

                await client.query('commit');

                return {
                    type:'OK',
                    item,
                    quantity,
                    inventoryQuantity:inventory.after,
                    storageQuantity:storage.after
                };
            } catch (err) {
                await client.query('rollback');
                if (isDuplicateRequest(err)) return {type:'DUPLICATE_REQUEST'};
                throw err;
            } finally {
                client.release();
            }
        },

        async changeInventoryQuantity(client, characterId, itemId, delta) {
            return changeInventoryQuantity(client, characterId, itemId, delta);
        },

        async changeStorageQuantity(client, itemId, delta) {
            return changeStorageQuantity(client, itemId, delta);
        }
    };
}