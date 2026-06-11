import Router from 'express';
const router = Router();
import postOwnersController from './postOwner.controller.js';

//post_owner routes
router.post('/create', postOwnersController.createPostOwner);
router.get('/get', postOwnersController.getAllPostOwner);
router.get('/get/:postownerid', postOwnersController.getPostOwner);
router.patch('/update/:postownerid', postOwnersController.updatePostOwner);
router.delete('/delete/:postownerid', postOwnersController.deletePostOwner);

export default router;
