import type { JSX, ReactNode } from "react";
import { PureComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const COMMON_STYLE_LINKS = [
  "https://cdnjs.cloudflare.com/ajax/libs/twitter-bootstrap/3.2.0/css/bootstrap.min.css",
  "https://ddo7jzca0m2vt.cloudfront.net/unify/css/style.css?version=20240112",
  "https://ddo7jzca0m2vt.cloudfront.net/css/connect.css?version=20240112",
  "https://ddo7jzca0m2vt.cloudfront.net/css/result.css?version=20240112",
  "https://ddo7jzca0m2vt.cloudfront.net/css/label.css?version=20240112",
  "https://ddo7jzca0m2vt.cloudfront.net/unify/css/custom.css?version=20240112",
  "https://cdnjs.cloudflare.com/ajax/libs/font-awesome/4.6.3/css/font-awesome.css",
  "https://ddo7jzca0m2vt.cloudfront.net/unify/css/theme-colors/blue.css?version=20240112",
  "https://ddo7jzca0m2vt.cloudfront.net/css/fa-color.css?version=20240112",
] as const;

const PROFILE_STYLE_LINKS = [
  ...COMMON_STYLE_LINKS,
  "https://ddo7jzca0m2vt.cloudfront.net/css/user_info.css?version=20240112",
] as const;

const FONT_HREF =
  "https://fonts.googleapis.com/css?family=Noto+Sans+KR:400,700|Open+Sans:400,400i,700,700i|Source+Code+Pro&subset=korean";

export const BOJ_APPLE_TOUCH_ICON_URL = "https://www.acmicpc.net/apple-touch-icon.png";
export const BOJ_FAVICON_32_URL = "https://www.acmicpc.net/favicon-32x32.png";
export const BOJ_FAVICON_16_URL = "https://www.acmicpc.net/favicon-16x16.png";
export const BOJ_MASK_ICON_URL = "https://www.acmicpc.net/safari-pinned-tab.svg";

export function renderReactPage(node: ReactNode): string {
  return `<!DOCTYPE html>${renderToStaticMarkup(node)}`;
}

interface ViewerDocumentProps {
  title: string;
  body: ReactNode;
  styleText?: string;
  includeUserInfoCss?: boolean;
  scripts?: ReactNode;
}

export function ViewerDocument(props: ViewerDocumentProps): string {
  return renderReactPage(<ViewerDocumentMarkup {...props} />);
}

class ViewerDocumentMarkup extends PureComponent<ViewerDocumentProps> {
  public render(): JSX.Element {
    const { title, body, styleText, includeUserInfoCss, scripts } = this.props;
    const links = includeUserInfoCss ? PROFILE_STYLE_LINKS : COMMON_STYLE_LINKS;

    return (
      <html lang="ko">
        <head>
          <meta charSet="utf-8" />
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>{title}</title>
          <meta name="theme-color" content="#ffffff" />
          <link rel="apple-touch-icon" sizes="180x180" href={BOJ_APPLE_TOUCH_ICON_URL} />
          <link rel="icon" type="image/png" sizes="32x32" href={BOJ_FAVICON_32_URL} />
          <link rel="icon" type="image/png" sizes="16x16" href={BOJ_FAVICON_16_URL} />
          <link rel="mask-icon" href={BOJ_MASK_ICON_URL} color="#0076c0" />
          <link rel="shortcut icon" href={BOJ_FAVICON_32_URL} />
          {links.map((href) => (
            <link key={href} rel="stylesheet" href={href} />
          ))}
          <link href={FONT_HREF} rel="stylesheet" />
          {styleText ? <style dangerouslySetInnerHTML={{ __html: styleText }} /> : null}
        </head>
        <body>
          {body}
          {scripts}
        </body>
      </html>
    );
  }
}

export class JsonScript extends PureComponent<{ id: string; value: unknown }> {
  public render(): JSX.Element {
    return (
      <script
        id={this.props.id}
        type="application/json"
        dangerouslySetInnerHTML={{ __html: escapeScriptJson(this.props.value) }}
      />
    );
  }
}

function escapeScriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026");
}
