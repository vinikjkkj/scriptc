// Driver A: reaches wamPlugin(), the plugin factory.
import { wamPlugin } from '../pkgs/wam/index'
console.log('plugin:', typeof wamPlugin())
