import {AppError} from '../../shared/http.js';

export function createShopService(repository) {
    function ready() {
        if (!repository.getShopProducts || !repository.buyProduct) {
            throw new AppError(501, 'SHOP_UNAVAILABLE', '상점은 Supabase 모드에서 지원합니다.');
        }
    }
    return {
        async getProducts(userId) { ready(); return {products: await repository.getShopProducts(userId)}; },
        async buy(userId, productId, body) {
            if (typeof productId !== 'string' || !/^[1-9][0-9]{0,18}$/.test(productId) || BigInt(productId) > 9223372036854775807n) {
                throw new AppError(400, 'INVALID_PRODUCT_ID', '상품 ID는 양의 정수여야 합니다.');
            }
            if (!body || Array.isArray(body) || Object.keys(body).some(key => !['quantity','requestKey'].includes(key)) ||
                !Number.isInteger(body.quantity) || body.quantity < 1 || body.quantity > 2147483647) {
                throw new AppError(400, 'INVALID_PURCHASE', 'quantity는 양의 정수이며 requestKey만 함께 지정할 수 있습니다.');
            }
            if (typeof body.requestKey !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestKey)) {
                throw new AppError(400, 'INVALID_REQUEST_KEY', 'requestKey는 UUID여야 합니다.');
            }
            ready();
            return repository.buyProduct(userId, productId, body.quantity, body.requestKey.toLowerCase());
        }
    };
}
