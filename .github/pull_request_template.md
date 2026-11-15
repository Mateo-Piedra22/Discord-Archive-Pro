## Descripción de los cambios

Resume qué problema resuelve o qué mejora aporta este Pull Request.

## Tipo de cambio

- [ ] Corrección de error (`fix`)
- [ ] Nueva funcionalidad o mejora (`feat`)
- [ ] Documentación (`docs`)
- [ ] CI/CD, empaquetado o mantenimiento (`chore` / `ci`)
- [ ] Refactorización interna sin cambio funcional (`refactor`)

## Lista de verificación obligatoria

- [ ] `npm run typecheck` termina con código `0` (`tsconfig.node.json` y `tsconfig.web.json`).
- [ ] `npm test` pasa todas las suites unitarias en `src/` y `scripts/` sin saltos inesperados.
- [ ] `npm run build` compila main, preload y renderer sin errores.
- [ ] `npm run verify:release` pasa todas las comprobaciones de manifiesto, recursos y documentación.
- [ ] Todos los textos de interfaz, comentarios de código y mensajes están redactados en **español**.
- [ ] Se mantienen las invariantes de seguridad de Electron/IPC (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, validación de rutas con `isInside`/`isInsideReal`/`isInsideRealAsync`, cero fuentes o activos remotos en la UI, CSP intacta).
- [ ] Si afecta a la interfaz o al visor integrado, se ha comprobado visualmente en los tres temas (`Tinta oscura`, `Papel claro` y `Pergamino sepia`) sin valores CSS literales fuera de `tokens.css`.

## Pruebas realizadas y notas para quien revisa

Indica los comandos ejecutados, suites nuevas o actualizadas y cualquier detalle relevante sobre el alcance del cambio.
