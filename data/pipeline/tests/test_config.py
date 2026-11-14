import math

from red_atlas_p1 import config


def test_lon_conventions():
    assert math.isclose(config.lon180(283.6), -76.4, abs_tol=1e-9)
    assert math.isclose(config.lon360(-76.4), 283.6, abs_tol=1e-9)


def test_nodes_and_legs_loaded():
    assert set(config.scenario_nodes()) == {"BASE", "WP1", "WP2", "WP3"}
    assert {"L1", "L2", "L3", "L4", "R1"} <= set(config.scenario_legs())


def test_perimeter_matches_scenario():
    n = config.scenario_nodes()
    order = ["BASE", "WP1", "WP2", "WP3", "BASE"]
    total = sum(
        config.haversine_m(n[a]["lat_pc_deg"], n[a]["lon_e_deg"], n[b]["lat_pc_deg"], n[b]["lon_e_deg"])
        for a, b in zip(order, order[1:])
    )
    assert abs(total - 4900) < 5
