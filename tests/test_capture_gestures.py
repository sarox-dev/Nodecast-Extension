from pathlib import Path
import pytest
pw = pytest.importorskip("playwright.sync_api")


def test_floating_save_accepts_real_enter_and_click_only():
    text = (Path(__file__).resolve().parent.parent / "content.js").read_text()
    start = text.index("function showFloatingSave(")
    end = text.index("function prepareFloatingSave(", start)
    with pw.sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_page()
        page.set_content("<p>Selected text</p>")
        page.add_script_tag(content="""
          let floatingPackage, floatingHost;
          let saved = 0;
          function removeFloatingSave() { floatingHost?.remove(); }
          function sendRuntime(_message, callback) { saved++; callback({success:true}); }
          function extensionAvailable() { return true; }
          function notifyReloadRequired() {}
        """ + text[start:end])
        def show():
            page.evaluate("""() => showFloatingSave(
              {getBoundingClientRect:()=>({left:100,top:200,width:120,height:24})},
              {anchor:{selected_text:'Selected text'}}
            )""")
        show()
        page.evaluate("floatingHost.shadowRoot")  # Closed shadow is not exposed to page scripts.
        page.evaluate("floatingHost.dispatchEvent(new MouseEvent('click', {bubbles:true}))")
        assert page.evaluate("saved") == 0
        # Closed roots intentionally require a trusted keyboard focus path.
        rect = page.locator("#nodecast-floating-save-host").bounding_box()
        page.mouse.click(rect["x"] + 45, rect["y"] + rect["height"] / 2)
        page.keyboard.press("Enter")
        assert page.evaluate("saved") == 1
        browser.close()
