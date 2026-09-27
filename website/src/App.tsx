import { DocsPage } from "./components/Docs";
import { Home } from "./components/Home";
import { Footer, Header } from "./components/Layout";
import type { Page } from "./site";

/** The whole page for one route; identical on the server and the client. */
export function App({ page, docBody }: { page: Page; docBody: string }) {
  return (
    <>
      <Header page={page} />
      <main id="main">
        {page.kind === "home" ? (
          <Home />
        ) : (
          <DocsPage page={page} body={docBody} />
        )}
      </main>
      <Footer />
    </>
  );
}
