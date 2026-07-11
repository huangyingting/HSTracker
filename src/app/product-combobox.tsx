"use client";

import { useEffect, useId, useRef, useState } from "react";

import { ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS } from "../../test/fixtures/acceptance/v1/metadata";
import type {
  ProductSearchLocale,
  ProductSearchProduct,
  ProductSearchResult,
} from "../catalog/product-catalog";
import { isSuppressedProductQuery } from "../catalog/product-query";

const copy = {
  en: {
    eyebrow: "Choose a product",
    title: "Start with an HS 2012 product.",
    label: "HS 2012 product",
    help: "Search HS 2012 code or English/Chinese product words.",
    placeholder: "Code or product words",
    loading: "Searching products…",
    tooShort: "Enter at least two characters to search.",
    noMatch:
      "No HS 2012 product matched. Check the revision or try product words.",
    unsupported:
      "That HS revision is not supported. This workspace uses HS 2012.",
    failed: "Product search is temporarily unavailable.",
    selected: "Selected product",
    match: "Matched",
  },
  "zh-Hans": {
    eyebrow: "选择产品",
    title: "从一个 HS 2012 产品开始。",
    label: "HS 2012 产品",
    help: "搜索 HS 2012 编码或中英文产品词语。",
    placeholder: "编码或产品词语",
    loading: "正在搜索产品…",
    tooShort: "请输入至少两个字符进行搜索。",
    noMatch: "未找到匹配的 HS 2012 产品。请检查版本或尝试产品词语。",
    unsupported: "不支持该 HS 版本。本工作区使用 HS 2012。",
    failed: "产品搜索暂时不可用。",
    selected: "已选择产品",
    match: "匹配内容",
  },
} as const;

type ProductComboboxProps = {
  locale: ProductSearchLocale;
};

type SearchMatch = ProductSearchResult["matches"][number];

export function ProductCombobox({ locale }: ProductComboboxProps) {
  const messages = copy[locale];
  const listboxId = useId();
  const requestSequence = useRef(0);
  const userInteracted = useRef(false);
  const initialLocale = useRef(locale);
  const [inputValue, setInputValue] = useState("");
  const [searchLocale, setSearchLocale] =
    useState<ProductSearchLocale>(locale);
  const [matches, setMatches] = useState<readonly SearchMatch[]>([]);
  const [selectedProduct, setSelectedProduct] =
    useState<ProductSearchProduct | null>(null);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<
    "idle" | "loading" | "too-short" | "no-match" | "unsupported" | "failed"
  >("idle");

  useEffect(() => {
    const url = new URL(window.location.href);
    const revision = url.searchParams.get("revision");
    const productCode = url.searchParams.get("product");
    if (
      revision !== "HS12" ||
      productCode === null ||
      !/^\d{6}$/u.test(productCode)
    ) {
      return;
    }

    const controller = new AbortController();
    void (async () => {
      try {
        const parameters = new URLSearchParams({
          q: productCode,
          locale: initialLocale.current,
          limit: "20",
        });
        const response = await fetch(
          `/api/v1/product-catalogs/${ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core}/products?${parameters}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(`Product restoration returned ${response.status}.`);
        }
        const result = (await response.json()) as ProductSearchResult;
        const restoredProduct = result.matches.find(
          ({ product, match }) =>
            product.code === productCode && match.class === "EXACT_CODE",
        )?.product;
        if (!userInteracted.current && restoredProduct !== undefined) {
          setSelectedProduct(restoredProduct);
          setStatus("idle");
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error("Canonical product restoration failed", error);
        if (!userInteracted.current) {
          setStatus("failed");
        }
      }
    })();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    if (selectedProduct !== null) {
      return;
    }

    const normalized = inputValue.normalize("NFKC").trim();
    if (
      normalized.length === 0 ||
      isSuppressedProductQuery(normalized)
    ) {
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setStatus("loading");
      try {
        const parameters = new URLSearchParams({
          q: inputValue,
          locale: searchLocale,
          limit: "20",
        });
        const response = await fetch(
          `/api/v1/product-catalogs/${ACCEPTANCE_PRODUCT_SEARCH_BUILD_IDS.core}/products?${parameters}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          throw new Error(`Product search returned ${response.status}.`);
        }
        const result = (await response.json()) as ProductSearchResult;
        if (requestSequence.current !== sequence) {
          return;
        }

        setActiveIndex(-1);
        if (result.state === "RESULTS") {
          setMatches(result.matches);
          setOpen(result.matches.length > 0);
          setStatus("idle");
        } else {
          setMatches([]);
          setOpen(false);
          setStatus(
            result.state === "UNSUPPORTED_HS_REVISION"
              ? "unsupported"
              : result.state === "SUPPRESSED_SHORT_QUERY"
                ? "too-short"
                : "no-match",
          );
        }
      } catch (error) {
        if (
          controller.signal.aborted ||
          requestSequence.current !== sequence
        ) {
          return;
        }
        console.error("Product search request failed", error);
        setMatches([]);
        setOpen(false);
        setStatus("failed");
      }
    }, 150);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [inputValue, searchLocale, selectedProduct]);

  function selectProduct(product: ProductSearchProduct) {
    userInteracted.current = true;
    setSelectedProduct(product);
    setMatches([]);
    setActiveIndex(-1);
    setOpen(false);
    setStatus("idle");

    const url = new URL(window.location.href);
    url.searchParams.set("revision", "HS12");
    url.searchParams.set("product", product.code);
    window.history.replaceState(null, "", url);
  }

  function clearSelectedIdentity() {
    if (selectedProduct === null) {
      return;
    }
    setSelectedProduct(null);
    const url = new URL(window.location.href);
    url.searchParams.delete("revision");
    url.searchParams.delete("product");
    window.history.replaceState(null, "", url);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      }
      return;
    }
    if (matches.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) => (current + 1) % matches.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((current) =>
        current <= 0 ? matches.length - 1 : current - 1,
      );
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      selectProduct(matches[activeIndex].product);
    }
  }

  return (
    <section className="product-discovery" aria-labelledby="product-title">
      <p className="product-eyebrow">{messages.eyebrow}</p>
      <h2 id="product-title">{messages.title}</h2>
      <div className="product-field">
        <label htmlFor="product-search">{messages.label}</label>
        <div className="product-input-frame">
          <span aria-hidden="true">HS12</span>
          <input
            id="product-search"
            type="search"
            role="combobox"
            autoComplete="off"
            spellCheck="false"
            value={
              selectedProduct === null
                ? inputValue
                : productLabel(selectedProduct, locale)
            }
            placeholder={messages.placeholder}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={open}
            aria-activedescendant={
              open && activeIndex >= 0
                ? optionId(matches[activeIndex].product.code)
                : undefined
            }
            aria-describedby="product-search-help product-search-status"
            onChange={(event) => {
              userInteracted.current = true;
              const nextValue = event.target.value;
              clearSelectedIdentity();
              setInputValue(nextValue);
              setSearchLocale(locale);
              setMatches([]);
              setActiveIndex(-1);
              setOpen(false);
              const normalized = nextValue.normalize("NFKC").trim();
              setStatus(
                normalized.length === 0
                  ? "idle"
                  : isSuppressedProductQuery(normalized)
                    ? "too-short"
                    : "idle",
              );
            }}
            onFocus={() => {
              if (matches.length > 0) {
                setOpen(true);
              }
            }}
            onBlur={() => {
              setOpen(false);
              setActiveIndex(-1);
            }}
            onKeyDown={handleKeyDown}
          />
        </div>
        <p id="product-search-help" className="product-help">
          {messages.help}
        </p>
        {selectedProduct === null ? null : (
          <div
            className="product-selection"
            aria-label={messages.selected}
          >
            <strong>HS 2012 · {selectedProduct.code}</strong>
            <span>{productDescription(selectedProduct, locale)}</span>
            <small>
              {adjacentProductDescription(selectedProduct, locale)}
            </small>
          </div>
        )}
        {open ? (
          <ul
            id={listboxId}
            className="product-options"
            role="listbox"
            aria-label={messages.label}
          >
            {matches.map(({ product, match }, index) => (
              <li
                id={optionId(product.code)}
                key={product.code}
                role="option"
                aria-selected={index === activeIndex}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectProduct(product)}
              >
                <strong>HS 2012 · {product.code}</strong>
                <span className="product-primary-description">
                  {productDescription(product, locale)}
                </span>
                <span className="product-adjacent-description">
                  {adjacentProductDescription(product, locale)}
                </span>
                <small>
                  {messages.match}: {match.matchedText}
                </small>
              </li>
            ))}
          </ul>
        ) : null}
        <p
          id="product-search-status"
          className={`product-status product-status-${status}`}
          aria-live="polite"
        >
          {status === "loading"
            ? messages.loading
            : status === "too-short"
              ? messages.tooShort
              : status === "no-match"
                ? messages.noMatch
                : status === "unsupported"
                  ? messages.unsupported
                  : status === "failed"
                    ? messages.failed
                    : selectedProduct === null
                      ? ""
                      : `${messages.selected}: HS 2012 · ${selectedProduct.code}`}
        </p>
      </div>
    </section>
  );
}

function productDescription(
  product: ProductSearchProduct,
  locale: ProductSearchLocale,
): string {
  return locale === "en"
    ? product.sourceDescriptionEn
    : product.auxiliaryDescriptionZhHans;
}

function productLabel(
  product: ProductSearchProduct,
  locale: ProductSearchLocale,
): string {
  return `HS 2012 · ${product.code} — ${productDescription(product, locale)}`;
}

function adjacentProductDescription(
  product: ProductSearchProduct,
  locale: ProductSearchLocale,
): string {
  return locale === "en"
    ? product.auxiliaryDescriptionZhHans
    : product.sourceDescriptionEn;
}

function optionId(productCode: string): string {
  return `product-option-${productCode}`;
}
