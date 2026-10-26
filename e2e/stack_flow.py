"""
End-to-end check of the back office against the real backend (Docker Compose stand).
Walks the three screens of iteration 1 with the demo user and fails on any page error,
any 5xx response, or a missing expected element. Screenshots go to e2e/out/.

    python e2e/stack_flow.py http://localhost:8081
"""
import asyncio
import os
import sys

from playwright.async_api import async_playwright, expect

BASE = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8081"
OUT = os.path.join(os.path.dirname(__file__), "out")
os.makedirs(OUT, exist_ok=True)


async def main():
    problems = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"])
        page = await browser.new_page(viewport={"width": 1440, "height": 1000})
        page.on("pageerror", lambda e: problems.append(f"page error: {e}"))
        page.on("response", lambda r: problems.append(f"{r.status} {r.request.method} {r.url}") if r.status >= 500 else None)

        async def shot(name):
            await page.screenshot(path=os.path.join(OUT, f"{name}.png"))

        try:
            await flow(page, shot)
        except Exception:
            await shot("failure")
            print("\n".join(problems))
            raise
        await browser.close()

    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print("e2e OK")


async def flow(page, shot):
    # 1. Dashboard: live numbers from the backend.
    await page.goto(f"{BASE}/#/dashboard")
    await expect(page.get_by_text("464", exact=True).first).to_be_visible(timeout=30000)
    await expect(page.get_by_text("Stryków · Magazyn B").first).to_be_visible()
    await page.wait_for_timeout(1500)
    await shot("1_dashboard")

    # 2. Projects → Stryków schedule, then auto-assign preview.
    await page.goto(f"{BASE}/#/workforce/projects")
    await page.get_by_text("Stryków · Magazyn B").first.click()
    await expect(page.get_by_text("229").first).to_be_visible(timeout=20000)
    await shot("2_schedule")
    await page.get_by_role("button", name="Автораспределение AI").click()
    await page.get_by_role("button", name="Рассчитать").click()
    await page.wait_for_timeout(4000)
    await shot("3_autoassign")
    await page.keyboard.press("Escape")

    # 3. Timesheets → Stryków → correct Viktor's 23.10 → send to client.
    await page.goto(f"{BASE}/#/timesheets")
    await page.get_by_text("Stryków · Magazyn B").first.click()
    cell = page.get_by_role("button", name="Viktor Hnatiuk, 23.10").first
    await expect(cell).to_be_visible(timeout=20000)
    await cell.click()
    await expect(page.get_by_text("05:56").first).to_be_visible(timeout=10000)
    await shot("4_correction_panel")
    await page.fill("#ts-pay", "8")
    await page.fill("#ts-bill", "8")
    await page.get_by_role("button", name="Сохранить").click()
    await page.wait_for_timeout(2000)
    await shot("5_corrected")

    # 4. Client request: accept, then the staffing table appears.
    await page.goto(f"{BASE}/#/requests")
    await page.get_by_role("button", name="1197", exact=True).click()
    await expect(page.get_by_text("Szczyt przed akcją").first).to_be_visible(timeout=15000)
    await page.get_by_role("button", name="Принять в работу").click()
    await expect(page.get_by_text("0/8").first).to_be_visible(timeout=15000)
    await shot("6_request_accepted")

    # 5. Timesheet dispute: open from the list, agree with the client's hours.
    await page.goto(f"{BASE}/#/timesheets/disputes")
    await page.get_by_text("Часов больше, чем фактически").first.click()
    await page.get_by_role("button", name="Согласиться", exact=True).click()
    await page.get_by_role("button", name="Согласиться и исправить часы").click()
    await expect(page.get_by_text("Спор закрыт").first).to_be_visible(timeout=15000)
    await expect(page.get_by_text("Согласовано · Marta Kowalska").first).to_be_visible(timeout=15000)
    await shot("7_dispute_agreed")

    # 6. Global search.
    await page.keyboard.press("Control+k")
    await page.keyboard.type("Rudenko")
    await expect(page.get_by_text("Dmytro Rudenko").first).to_be_visible(timeout=10000)
    await shot("8_search")


asyncio.run(main())
