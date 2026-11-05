from app.import_data import count_rows, import_all

EXPECTED_ROWS = {"products": 25, "leads": 5000, "gstin_registry": 3534, "udyam_registry": 2723}


def get_product(client, product_id):
    products = client.get("/api/catalogue/products").json()
    return next(p for p in products if p["product_id"] == product_id)


def test_import_loads_every_row():
    assert count_rows() == EXPECTED_ROWS


def test_running_import_twice_does_not_duplicate_rows():
    import_all()
    assert count_rows() == EXPECTED_ROWS


def test_health(client):
    assert client.get("/api/health").json() == {"status": "ok"}


def test_catalogue_returns_all_products_in_order(client):
    response = client.get("/api/catalogue/products")
    assert response.status_code == 200
    ids = [p["product_id"] for p in response.json()]
    assert len(ids) == 25
    assert ids == sorted(ids)


def test_product_with_no_dependency_has_empty_list(client):
    product = get_product(client, "P01")
    assert product["requires_one_of"] == []
    assert product["requires_gstin"] is False
    assert product["city_tiers"] == [1, 2]


def test_tier_1_only_product_is_read_correctly(client):
    product = get_product(client, "P03")
    assert product["city_tiers"] == [1]
    assert product["requires_gstin"] is True


def test_failover_dependency_excludes_airfiber(client):
    # P09 needs a wired main link, so 5G AirFiber (P04) must not count.
    product = get_product(client, "P09")
    assert product["requires_one_of"] == ["P01", "P02", "P03", "P05", "P06"]
    assert product["setup_fee_inr"] == 1500
