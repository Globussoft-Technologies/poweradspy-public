
import postOwnerValidation from "./postOwner.validation.js";
import db from '../../Sequelize_cli/models/index.js'
import Response from '../../utils/response.js'
import logger from "../../resources/logs/logger.log.js";
import config from "config";
const post_Owner = db.tiktok_ad_post_owners;
class PostOwnersService {
    //this function is used for the create the post_owner
    async createPostOwner(req, res) {
        try {
            const data = req.body;
            const { value, error } = postOwnerValidation.createOwnerDetails(data);

            logger.error(error);
            if (error) return res.send(Response.validationFailResp('VALIDATION_FAIL', error));
            const adExist = await post_Owner.findOne({
                where: { post_owner: value.post_owner }
            });
            if (!adExist) {
                let ownerData = await post_Owner.create(value);
                return res.send(Response.userSuccessResp('New post_owner inserted successfully', ownerData));
            }
            else {
                await post_Owner.update(value, {
                    where: { post_owner: value.post_owner },
                });
                let updated = await post_Owner.findOne({
                    where: { post_owner: value.post_owner }
                });
                return res.send(Response.userSuccessResp('post_owner updated successfully', updated));
            }
        } catch (err) {
            res.send(Response.userFailResp('Failed to add post_owner details', err))
        }
    }
   
    //this function is used for update the post_owner
    async updatePostOwner(req, res) {
        try {
            const {postownerid}=req.params
            const postOwnerData = req?.body;
            const { value, error } = postOwnerValidation.updateOwnerDetails(postOwnerData);
            logger.error(error);
            if (error) return res.send(Response.validationFailResp('VALIDATION_FAIL', error));

            const existingPostOwner = await post_Owner.findOne({ where: { id: postownerid } });
            if (!existingPostOwner) {
                return res.send(Response.userFailResp("Invalid post owner ID"));
            }
            const newData= await post_Owner.update(  postOwnerData,
                    {
                        where: { id:postownerid }
                    })
            if (newData) {
                return res.send(Response.userSuccessResp("post owner data updated successfully", newData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to update post owner data.", err));
        }
    }
    

    //this function is used for get all the post_owners
    async getAllPostOwner(req, res) {
        try {
            let dataFind = await post_Owner.findAll();
             if (dataFind) {
                 return res.send(Response.userSuccessResp("Country gender info fetched successfully", dataFind));
             }
         } catch (err) {
             logger.error(`${err}`);
             return res.send(Response.userFailResp("Failed to fetch Country gender.", err));
         }
    }

    //this function is used for get the post_woner based on its id 
    async getPostOwner(req, res) {
        try {
            let {postownerid}= req.params
            let dataFind;
            if (postownerid) {
                dataFind = await post_Owner.findOne({ where: { id: postownerid } });
            } 
            if (dataFind) {
                return res.send(Response.userSuccessResp("Post owner info fetched successfully", dataFind));
            }
            return res.send(Response.userFailResp("No data Found",));
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to fetch post owner with this postowner id.", err));
        }
    }

    //this function is used for delete the post_ownre based on its id
    async deletePostOwner(req, res) {
        try {
            const {postownerid}=req?.params
            const existingPostOwner = await post_Owner.findOne({ where: { id: postownerid } });
            if (!existingPostOwner) {
                return res.send(Response.userFailResp("Invalid post owner ID"));
            }
            let deleteData= await post_Owner.destroy(  {
                        where: { id: postownerid }
                    })
            if (deleteData) {
                return res.send(Response.userSuccessResp("post owner id deleted successfully", deleteData));
            }
        } catch (err) {
            logger.error(`${err}`);
            return res.send(Response.userFailResp("Failed to delete post owner Id.", err));
        }
    }

}
export default new PostOwnersService();